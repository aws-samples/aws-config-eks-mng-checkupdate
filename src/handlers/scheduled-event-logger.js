// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

'use strict';

let ec2_client = require("@aws-sdk/client-ec2"); // Loads the AWS SDK for JavaScript.
let eks_client = require("@aws-sdk/client-eks"); // Loads the AWS SDK for JavaScript.
let config_client = require("@aws-sdk/client-config-service"); // Loads the AWS SDK for JavaScript.
let eks = new eks_client.EKS();
let ec2 = new ec2_client.EC2()
let semver = require('semver');
let sprintf = require('sprintf-js').sprintf
let client_ssm = require("@aws-sdk/client-ssm");
const ssm = new client_ssm.SSM();

let amiTypeDetails = {
  BOTTLEROCKET_x86_64 : {
    name : "BottleRocket",
    arch: "x86_64",
    versionRegEx : /^.*-.*-.*-.*-.*-v(?<version>[^-]*)-.*$/, //bottlerocket-aws-k8s-1.21-x86_64-v1.7.1-5025d720
    cleanReleaseVersionRegEx: /^(?<version>[^-]*)-.*$/,
    isGt: (previousElement, element) => semver.gt(previousElement, element),
    ssmPath: "/aws/service/bottlerocket/aws-k8s-%(clusterVersion)s%(amiSuffix)s/%(arch)s/latest/image_id"
  },
  AL2_x86_64 : {
    name : "Amazon Linux 2",
    arch : "x86_64",
    versionRegEx : /^.*-.*-.*-.*-v(?<version>[^-]*)$/, // amazon-eks-node-1.21-v20220824
    cleanReleaseVersionRegEx: /^.*-(?<version>[^-]*)$/,
    isGt: (previousElement, element) => previousElement > element,
    ssmPath: "/aws/service/eks/optimized-ami/%(clusterVersion)s/amazon-linux-2%(amiSuffix)s/recommended/image_id"
  },
  AL2_x86_64_GPU : {
    name : "Amazon Linux 2 with GPU",
    arch : "x86_64",
    versionRegEx : /^.*-.*-.*-.*-.*-v(?<version>[^-]*)$/, // amazon-eks-gpu-node-1.21-v20220914
    cleanReleaseVersionRegEx: /^.*-(?<version>[^-]*)$/,
    isGt: (previousElement, element) => previousElement > element,
    ssmPath: "/aws/service/eks/optimized-ami/%(clusterVersion)s/amazon-linux-2-gpu/recommended/image_id"
  },
  AL2_ARM_64: {
    name : "Amazon Linux 2 ARM64",
    arch : "arm64",
    versionRegEx : /^.*-.*-.*-.*-.*-v(?<version>[^-]*)$/,
    cleanReleaseVersionRegEx: /^.*-(?<version>[^-]*)$/,
    isGt: (previousElement, element) => previousElement > element,
    ssmPath: "/aws/service/eks/optimized-ami/%(clusterVersion)s/amazon-linux-2-arm64/recommended/image_id"
  },
  BOTTLEROCKET_ARM_64: {
    name : "BottleRocket ARM64",
    arch : "arm64",
    versionRegEx : /^.*-.*-.*-.*-.*-v(?<version>[^-]*)-.*$/, // bottlerocket-aws-k8s-1.23-aarch64-v1.11.0-b530f308
    cleanReleaseVersionRegEx: /^(?<version>[^-]*)-.*$/,
    isGt: (previousElement, element) => semver.gt(previousElement, element),
    ssmPath: "/aws/service/bottlerocket/aws-k8s-%(clusterVersion)s%(amiSuffix)s/%(arch)s/latest/image_id"
  }
  //TODO AL2 ARM NVIDIA
  //TODO BR ARM NVIDIA // BOTTLEROCKET_x86_64_NVIDIA
};

const config = new config_client.ConfigService();
const COMPLIANCE_STATES = {
    COMPLIANT: 'COMPLIANT',
    NON_COMPLIANT: 'NON_COMPLIANT',
    NOT_APPLICABLE: 'NOT_APPLICABLE',
};

async function processListNodeGroups(clusterName, nodegroupsList) {

  let p_arr = [];
      
  for(let i = 0; i<nodegroupsList.nodegroups.length; i++) {
    let nodegroup = nodegroupsList.nodegroups[i];
    console.log('Doing nodegroup: ' + nodegroup)
    var params = {
      clusterName: clusterName,
      nodegroupName: nodegroup
    };
    
    // Calling describe so we can find other max version available.
    let dng = await eks.describeNodegroup(params);
    let { clusterVersion, currentVersion, amiType, nodegroupArn } = processDescribeNodeGroup(dng);
    let amiDetails;
    try {
      amiDetails = getAmiDetails(amiType);
    } catch (error) {
      console.warn('Unsupported AMI TYPE : ' + amiType);
      continue;
    }
    try {
      const maxVersion = await findMaxVersionFromSSM(clusterVersion, amiDetails);
      compareAndTestCompliance(maxVersion, currentVersion, amiDetails);
      console.debug('No update needed for: ' + nodegroup)
      p_arr.push(Promise.resolve({ status : COMPLIANCE_STATES.COMPLIANT, name: nodegroup, arn: nodegroupArn}));
    } catch (error) {
      console.warn('Non-compliant or error received: ' + error)
      p_arr.push(Promise.resolve({ status : COMPLIANCE_STATES.NON_COMPLIANT, name: nodegroup, arn: nodegroupArn}));
    }
  }
  return Promise.all(p_arr);
}

function getAmiDetails(amiType) {
  if (!(amiType in amiTypeDetails)) { throw Error("amiType not supported " + amiType); }
  let amiFilter = amiTypeDetails[amiType];
  return amiFilter;
}

function processDescribeNodeGroup(data) {
  console.debug("DNG " + JSON.stringify(data));

  let clusterVersion = data.nodegroup.version;
  let currentVersion = data.nodegroup.releaseVersion;
  let amiType = data.nodegroup.amiType;
  let nodegroupArn = data.nodegroup.nodegroupArn;
  
  return { clusterVersion, currentVersion, amiType, nodegroupArn};
}

// Evaluates the configuration items in the snapshot and returns the compliance value to the handler.
function evaluateCompliance(cleanedVersion, maxVersion, isGt) {

    // Validate
    if (isGt(maxVersion.groups.version, cleanedVersion.groups.version)) {
        console.info("Update is needed current: " + cleanedVersion.groups.version + " New version: " +  maxVersion.groups.version)
        return COMPLIANCE_STATES.NON_COMPLIANT;
    } else {
        console.debug("Version is current: " + cleanedVersion.groups.version + " New version: " +  maxVersion.groups.version)
        return COMPLIANCE_STATES.COMPLIANT;
    }
}

/**
 * Determine if we were called for a specific cluster or for the full account (Periodic).
 * @param invokingEvent
 * @returns 
 */
async function checkModeAndReturnClusters(invokingEvent) {
  let lc = {
    "clusters": [],
  };
  if (invokingEvent.messageType === 'ConfigurationItemChangeNotification' && invokingEvent.configurationItem.resourceType === "AWS::EKS::Cluster") {
    lc.clusters = [invokingEvent.configurationItem.resourceName]
    console.debug('We received 1 cluster ' + JSON.stringify(lc.clusters))
  } else if (invokingEvent.messageType === 'ScheduledNotification') {
      lc = await eks.listClusters({})
      console.debug('Clusters found ' + JSON.stringify(lc.clusters));
  } else {
    throw new Error('Called from a non-supported event');
  }
  return lc;
}

function compareAndTestCompliance(maxVersion, currentVersion, amiDetails) {
  let cleanedVersion = amiDetails.cleanReleaseVersionRegEx.exec(currentVersion)
  console.debug('Cleaned' + JSON.stringify(cleanedVersion));
  console.debug('MV' + JSON.stringify(maxVersion));

  if (evaluateCompliance(cleanedVersion, maxVersion, amiDetails.isGt) !== COMPLIANCE_STATES.COMPLIANT) {
    console.debug('Throwing non compliant error');
    throw new Error("MNG is not compliant")
  }
}

function buildResponseNodeGroup(clusterName, nodeGroup) {
    
  console.debug("Got result: " + JSON.stringify(nodeGroup))
  let putEvaluationsRequest = {};
  if (nodeGroup.status === COMPLIANCE_STATES.COMPLIANT) {
    putEvaluationsRequest = {
          // Applies the evaluation result to the AWS account published in the event.
          ComplianceResourceType: "AWS::EKS::Nodegroup",
          ComplianceResourceId: nodeGroup.arn,
          ComplianceType: COMPLIANCE_STATES.COMPLIANT,
          OrderingTimestamp: new Date(),
          Annotation: sprintf("Cluster: %s MNG: %s is compliant", clusterName, nodeGroup.name)
    };
  } else {
    putEvaluationsRequest = {
          // Applies the evaluation result to the AWS account published in the event.
          ComplianceResourceType: "AWS::EKS::Nodegroup",
          ComplianceResourceId: nodeGroup.arn,
          ComplianceType: COMPLIANCE_STATES.NON_COMPLIANT,
          OrderingTimestamp: new Date(),
          Annotation: sprintf("Cluster: %s MNG: %s needs updating", clusterName, nodeGroup.name)
    };
  }

  console.debug("Sending status " + JSON.stringify(putEvaluationsRequest));
  return putEvaluationsRequest;
}
async function findMaxVersionFromSSM(clusterVersion, amiDetails) {
  let ssmPath = sprintf(amiDetails.ssmPath, { "clusterVersion": clusterVersion, "amiSuffix": "", "arch": amiDetails.arch })

  try {
    console.debug("SSMPath is ", ssmPath);
    let ssmResponse = await ssm.getParameter({ "Name" : ssmPath});
    // Get latest AMI/LT
    var params = {
      ImageIds: [ ssmResponse.Parameter.Value ]
    };
    let di = await ec2.describeImages(params);
    console.assert(di.length !== 0, "We found no images");
    
    let maxVersionName = amiDetails.versionRegEx.exec(di.Images[0].Name);
    return maxVersionName;
  } catch (e) {
    throw new Error("Impossible to find max version from SSM", e);
  }
}

/**
 * Entry point for our custom Config Rule
 */
exports.scheduledEventLoggerHandler = async (event, context) => {
    const invokingEvent = JSON.parse(event.invokingEvent);
    console.debug(invokingEvent);
    let appConfig = {
        "resultToken": ""
    };
    // Info needed to send result to AWS Config
    appConfig.resultToken = event.resultToken;
    
    let lc = await checkModeAndReturnClusters(invokingEvent);
    let clusters = 0;
    for (let i = 0; i < lc.clusters.length; i++) {

      let clusterName = lc.clusters[i];
      console.info('Processing MNG for cluster ' + clusterName);
      let params = {
        clusterName: clusterName
      };
      try {
        var lngs = await eks.listNodegroups(params);
      } catch ( error ) {
        console.error("Error getting nodegroups: " + error);
        throw error;
      }
      var nodeGroups = await processListNodeGroups(clusterName, lngs);
      try {
        console.debug("Got nodeGroups: " + JSON.stringify(nodeGroups))
        let nodeGroupResponses = [];
        nodeGroups.forEach((nodeGroup) => {
          nodeGroupResponses.push(buildResponseNodeGroup(clusterName, nodeGroup));
        });

        let response = {
          Evaluations: nodeGroupResponses,
          ResultToken: appConfig.resultToken,
        }
        let config_response = await config.putEvaluations(response);
        if ( 'FailedEvaluations' in config_response && config_response.FailedEvaluations.length > 0) {
            // Ends the function execution if any evaluation results are not successfully reported
            throw new Error(config_response);
        }
        clusters++;
      } catch ( error ) {
        console.error("Error reporting result to AWS Config: " + error);
      }
    }
    console.debug('We reported ' + clusters + ' clusters compliance');
}
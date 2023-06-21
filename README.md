# AWS Config custom rule for EKS managed node group version check

This project contains source code and supporting files for a custom AWS Config rule that checks and report status of new AMI available for Managed Node Groups (MNG) in Amazon EKS. The [SAM toolkit](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-getting-started.html) is used to deploy the AWS Lambda, and the corresponding AWS Config rule.

## How to deploy

To deploy the AWS Lambda and associated AWS Config rule, this will activate the AWS Config rule in the current region of your account and monitor the EKS cluster from that region.

```bash
# You could download the zip from github instead of git clone
git clone https://github.com/aws-samples/aws-config-custom-rule-eks-mng.git
cd aws-config-custom-rule-eks-mng
sam build
sam deploy --guided
```

## Supported AMI per architecture

| Distribution   | amd64 | arm64 | amd64/nvidia |
| :------------- | :---: | :---: | :----------: |
| Amazon Linux 2 | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Bottlerocket   | :white_check_mark: | :white_check_mark: | :red_circle: |

## License
This library is licensed under the MIT-0 License. See the LICENSE file.
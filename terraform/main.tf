provider "aws" {
}

provider "kubernetes" {
  host                   = module.eks_blueprints.eks_cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks_blueprints.eks_cluster_certificate_authority_data)
  token                  = data.aws_eks_cluster_auth.this.token
}

data "aws_eks_cluster_auth" "this" {
  name = module.eks_blueprints.eks_cluster_id
}

data "aws_availability_zones" "available" {
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  name = basename(path.cwd)
  cluster_name = "config-eks-ami"

  vpc_cidr = "10.0.0.0/16"
  azs      = slice(data.aws_availability_zones.available.names, 0, 3)

  tags = {
    GithubRepo = "github.com/aws-samples/eks-config-ami"
  }
}

#---------------------------------------------------------------
# EKS Blueprints
#---------------------------------------------------------------

module "eks_blueprints" {
  source = "github.com/aws-ia/terraform-aws-eks-blueprints?ref=v4.16.0"

  cluster_name    = local.cluster_name
  cluster_version = "1.23"

  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnets

  managed_node_groups = {
    BOTTLEROCKET_x86_64 = {
      node_group_name = "br-amd64-current"
      ami_type = "BOTTLEROCKET_x86_64"
      instance_types  = ["t3.medium"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
    AL2_x86_64 = {
      node_group_name = "al2-amd64-current"
      ami_type = "AL2_x86_64"
      instance_types  = ["t3.medium"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
    AL2_x86_64_GPU = {
      node_group_name = "al2-amd64-gpu-current"
      ami_type = "AL2_x86_64_GPU"
      instance_types  = ["g4dn.xlarge"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
    AL2_ARM_64 = {
      node_group_name = "al2-arm64-current"
      ami_type = "AL2_ARM_64"
      instance_types  = ["t4g.medium"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
    BOTTLEROCKET_ARM_64 = {
      node_group_name = "br-arm64-current"
      ami_type = "BOTTLEROCKET_ARM_64"
      instance_types  = ["t4g.medium"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
    CUSTOM = {
      node_group_name = "custom-ubuntu"
      ami = "ami-0c976f257ad2bdfb0"
      instance_types  = ["t3.medium"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
    BOTTLEROCKET_x86_64_O = {
      node_group_name = "br-amd64-outdated"
      ami_type = "BOTTLEROCKET_x86_64"
      release_version = "1.10.1-5d27ae74"
      instance_types  = ["t3.medium"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
    AL2_x86_64_O = {
      node_group_name = "al2-amd64-outdated"
      ami_type = "AL2_x86_64"
      release_version = "1.23.9-20221104"
      instance_types  = ["t3.medium"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
    AL2_x86_64_GPU_O = {
      node_group_name = "al2-amd64-gpu-outdated"
      ami_type = "AL2_x86_64_GPU"
      release_version = "1.23.9-20221104"
      instance_types  = ["g4dn.xlarge"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
    AL2_ARM_64_O = {
      node_group_name = "al2-arm64-outdated"
      ami_type = "AL2_ARM_64"
      release_version = "1.23.9-20221104"
      instance_types  = ["t4g.medium"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
    BOTTLEROCKET_ARM_64_O = {
      node_group_name = "br-arm64-outdated"
      ami_type = "BOTTLEROCKET_ARM_64"
      release_version = "1.10.1-5d27ae74"
      instance_types  = ["t4g.medium"]
      min_size        = 0
      max_size        = 1
      desired_size    = 0
      subnet_ids      = module.vpc.private_subnets
    }
  // Ref: https://docs.aws.amazon.com/eks/latest/APIReference/API_Nodegroup.html#AmazonEKS-Type-Nodegroup-amiType
  // Possible value: AL2_x86_64 | AL2_x86_64_GPU | AL2_ARM_64 | CUSTOM | BOTTLEROCKET_ARM_64 | BOTTLEROCKET_x86_64 | BOTTLEROCKET_ARM_64_NVIDIA | BOTTLEROCKET_x86_64_NVIDIA


  }

  tags = local.tags
}

#---------------------------------------------------------------
# Supporting Resources
#---------------------------------------------------------------

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 3.0"

  name = local.name
  cidr = local.vpc_cidr

  azs             = local.azs
  public_subnets  = [for k, v in local.azs : cidrsubnet(local.vpc_cidr, 8, k)]
  private_subnets = [for k, v in local.azs : cidrsubnet(local.vpc_cidr, 8, k + 10)]

  enable_nat_gateway   = true
  single_nat_gateway   = true
  enable_dns_hostnames = true

  # Manage so we can name
  manage_default_network_acl    = true
  default_network_acl_tags      = { Name = "${local.name}-default" }
  manage_default_route_table    = true
  default_route_table_tags      = { Name = "${local.name}-default" }
  manage_default_security_group = true
  default_security_group_tags   = { Name = "${local.name}-default" }

  public_subnet_tags = {
    "kubernetes.io/cluster/${local.cluster_name}" = "shared"
    "kubernetes.io/role/elb"                      = 1
  }

  private_subnet_tags = {
    "kubernetes.io/cluster/${local.cluster_name}" = "shared"
    "kubernetes.io/role/internal-elb"             = 1
  }

  tags = local.tags
}
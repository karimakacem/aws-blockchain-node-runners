export interface AvalancheNodeConfig {
  // Instance configuration
  instanceType: string;
  instanceCpuType: 'x86_64' | 'arm64';
  
  // Network configuration
  avalancheNetwork: 'mainnet' | 'fuji' | 'local';
  nodeType: 'validator' | 'api' | 'full';
  
  // Storage configuration
  dataVolumeSize: number;
  dataVolumeType: 'gp3' | 'io1' | 'io2';
  dataVolumeIops?: number;
  
  // Networking ports
  httpPort: number;
  stakingPort: number;
  
  // Avalanche specific
  avalanchegoVersion: string;
  enableStaking: boolean;
  
  // Monitoring
  enableCloudWatchLogs: boolean;
  
  // Security
  enableSsh: boolean;
}

export const avalancheNodeDefaultConfig: AvalancheNodeConfig = {
  instanceType: 'c6i.2xlarge',
  instanceCpuType: 'x86_64',
  avalancheNetwork: 'mainnet',
  nodeType: 'full',
  dataVolumeSize: 1000,
  dataVolumeType: 'gp3',
  dataVolumeIops: 3000,
  httpPort: 9650,
  stakingPort: 9651,
  avalanchegoVersion: 'v1.10.17',
  enableStaking: false,
  enableCloudWatchLogs: true,
  enableSsh: false,
};

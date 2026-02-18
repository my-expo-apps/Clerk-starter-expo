export const environments = {
  dev: {
    label: 'Development',
    envFile: '.env.dev',
  },
  staging: {
    label: 'Staging',
    envFile: '.env.staging',
  },
  prod: {
    label: 'Production',
    envFile: '.env.prod',
  },
} as const;

export type EnvironmentKey = keyof typeof environments;


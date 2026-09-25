export const FEATURES = {
  BUNDLE: 'BUNDLE',
}

const featureFlags = {
  [FEATURES.BUNDLE]: false,
}

export const hasFeature = feature => featureFlags[feature] || featureFlags[feature] === undefined

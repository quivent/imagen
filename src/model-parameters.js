export function modelRequest(base, profile, { modelSteps, modelResolution, modelGuidance, modelParameters }) {
  const parameters = modelParameters[profile];
  return { ...base, profile, width: modelResolution[profile], height: modelResolution[profile],
    steps: modelSteps[profile], guidance_scale: modelGuidance[profile] ?? parameters.guidance_scale,
    seed: parameters.seed, count: parameters.count };
}

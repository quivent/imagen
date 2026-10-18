export function mountModelStepButtons({ root, modelSteps, changed }) {
  const buttons = [...root.querySelectorAll('[data-step-button-profile]')];
  const handlers = new Map();
  function refresh() {
    for (const button of buttons) button.setAttribute('aria-pressed', String(modelSteps[button.dataset.stepButtonProfile] === Number(button.dataset.steps)));
  }
  for (const button of buttons) {
    const click = () => {
      const profile = button.dataset.stepButtonProfile;
      const value = Number(button.dataset.steps);
      if (!Object.hasOwn(modelSteps, profile) || !Number.isInteger(value) || value < 1 || value > 60) return;
      modelSteps[profile] = value;
      refresh();
      changed(profile, value);
    };
    handlers.set(button, click);
    button.addEventListener('click', click);
  }
  refresh();
  return { refresh, destroy() { for (const [button, click] of handlers) button.removeEventListener('click', click); } };
}

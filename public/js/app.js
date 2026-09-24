const campusImage = document.querySelector('.home-visual img');

if (campusImage && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => campusImage.classList.add('campus-image--revealing'));
  });
}

for (const form of document.querySelectorAll('[data-password-match-form]')) {
  const password = form.querySelector('[data-password-source]');
  const confirmation = form.querySelector('[data-password-confirm]');
  const message = form.querySelector('[data-password-mismatch-message]');

  if (!password || !confirmation || !message) continue;

  let mismatchFeedbackEnabled = false;

  const updateMismatch = () => {
    const hasBothValues = password.value.length > 0 && confirmation.value.length > 0;
    const mismatch = mismatchFeedbackEnabled && hasBothValues && password.value !== confirmation.value;

    confirmation.setAttribute('aria-invalid', String(mismatch));
    message.textContent = mismatch
      ? 'Passwords do not match. Enter the same password in both fields.'
      : '';
  };

  password.addEventListener('input', updateMismatch);
  confirmation.addEventListener('input', updateMismatch);
  confirmation.addEventListener('blur', () => {
    if (password.value.length > 0 && confirmation.value.length > 0) {
      mismatchFeedbackEnabled = true;
    }
    updateMismatch();
  });

  form.addEventListener('submit', (event) => {
    mismatchFeedbackEnabled = true;
    updateMismatch();
    if (password.value === confirmation.value) return;

    event.preventDefault();
    confirmation.focus();
  });
}

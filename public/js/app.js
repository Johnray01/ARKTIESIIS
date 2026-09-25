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

for (const form of document.querySelectorAll('form[method="post"]')) {
  const submitters = form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]');
  if (!submitters.length) continue;

  const status = document.createElement('p');
  status.className = 'submission-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.hidden = true;
  form.append(status);

  form.addEventListener('submit', (event) => {
    if (event.defaultPrevented) return;
    if (form.dataset.submitting === 'true') {
      event.preventDefault();
      return;
    }

    form.dataset.submitting = 'true';
    form.setAttribute('aria-busy', 'true');
    status.hidden = false;
    status.textContent = form.dataset.submittingMessage || 'Submitting your request. Please wait.';

    const submitter = event.submitter;
    if (submitter) {
      submitter.setAttribute('aria-disabled', 'true');
      if (submitter.dataset.submittingLabel) {
        submitter.dataset.originalSubmitLabel = submitter.textContent;
        submitter.textContent = submitter.dataset.submittingLabel;
      }
    }
  });
}

window.addEventListener('pageshow', () => {
  for (const form of document.querySelectorAll('form[method="post"]')) {
    if (form.dataset.submitting !== 'true') continue;

    form.dataset.submitting = 'false';
    form.removeAttribute('aria-busy');
    const status = form.querySelector('.submission-status');
    if (status) {
      status.hidden = true;
      status.textContent = '';
    }
    for (const submitter of form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]')) {
      submitter.removeAttribute('aria-disabled');
      if (submitter.dataset.originalSubmitLabel) {
        submitter.textContent = submitter.dataset.originalSubmitLabel;
        delete submitter.dataset.originalSubmitLabel;
      }
    }
  }
});

// Signup form rules. Shared by the page and the tests.
export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

export function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return ["weak", "weak", "okay", "good", "strong"][score];
}

export function validateSignup({ name, email, password }) {
  const errors = {};
  if (!name || !name.trim()) errors.name = "Tell us your name";
  if (!validateEmail(email)) errors.email = "That email doesn't look right";
  if (!password || password.length < 8) errors.password = "At least 8 characters";
  return { ok: Object.keys(errors).length === 0, errors };
}

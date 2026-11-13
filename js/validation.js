const patterns = {
  fullName: /^[a-zA-Z\s]{2,50}$/,
  empId: /^[A-Z0-9]{6,12}$/i,
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  mobile: /^[6-9]\d{9}$/,
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
};

const errorMessages = {
  fullName: "2–50 alphabets and spaces only.",
  empId: "6–12 alphanumeric characters required.",
  email: "Enter a valid email address.",
  mobile: "10-digit number starting with 6–9.",
  dept: "Please select a division/department.",
  password: "Min 8 chars with uppercase, lowercase, number & symbol (@$!%*?&).",
  confirmPassword: "Passwords do not match."
};

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("register-form");
  if (!form) return;

  const submitBtn = form.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.disabled = true;

  const validateField = (field) => {
    const errorSpan = field.parentElement.querySelector(".error-msg");
    let isValid = false;

    if (field.id === "dept") {
      isValid = field.value !== "";
    } else if (field.id === "confirmPassword") {
      const pwd = document.getElementById("password")?.value || "";
      isValid = field.value !== "" && field.value === pwd;
    } else if (patterns[field.id]) {
      isValid = patterns[field.id].test(field.value.trim());
    }

    field.classList.toggle("valid", isValid);
    field.classList.toggle("invalid", !isValid);
    if (errorSpan) {
      errorSpan.textContent = isValid ? "" : errorMessages[field.id];
    }
    return isValid;
  };

  const checkFormValidity = () => {
    const fields = Array.from(form.querySelectorAll("input, select"));
    const allValid = fields.every((f) => f.classList.contains("valid"));
    if (submitBtn) submitBtn.disabled = !allValid;
  };

  form.querySelectorAll("input, select").forEach((field) => {
    field.addEventListener("blur", () => {
      validateField(field);
      checkFormValidity();
    });
    field.addEventListener("input", () => {
      if (field.classList.contains("invalid") || field.classList.contains("valid")) {
        validateField(field);
        checkFormValidity();
      }
    });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fields = Array.from(form.querySelectorAll("input, select"));
    const allValid = fields.map(validateField).every(Boolean);
    if (allValid) {
      window.location.href = "home.html";
    }
  });
});

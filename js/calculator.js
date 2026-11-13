let calcExpression = "";

function pressKey(val) {
  const display = document.getElementById("calc-display");
  if (!display) return;

  if (val === "C") {
    calcExpression = "";
    display.value = "0";
    return;
  }

  if (val === "=") {
    try {
      if (/\/0(?![.\d])/.test(calcExpression)) throw new Error("DivByZero");
      const result = Function(`"use strict"; return (${calcExpression})`)();
      if (!isFinite(result)) throw new Error("MathError");
      display.value = result;
      calcExpression = String(result);
    } catch {
      display.value = "Error";
      calcExpression = "";
    }
    return;
  }

  calcExpression += val;
  display.value = calcExpression;
}

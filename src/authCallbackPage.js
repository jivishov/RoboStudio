import { authConfig, resolveAppUrl } from "./auth/authConfig.js";
import { completeAuthCallbackIfPresent } from "./auth/authCallback.js";

const status = document.querySelector("#auth-callback-status");

function setStatus(message) {
  if (status) status.textContent = message;
}

async function complete() {
  try {
    setStatus("Completing Google sign-in...");
    await completeAuthCallbackIfPresent();
    setStatus("Sign-in complete. Returning to the Component Builder...");
    window.location.replace(resolveAppUrl(authConfig.returnPath));
  } catch (error) {
    console.error("Google sign-in callback failed", error);
    setStatus(error instanceof Error && error.message ? error.message : "Google sign-in could not be completed.");
  }
}

void complete();

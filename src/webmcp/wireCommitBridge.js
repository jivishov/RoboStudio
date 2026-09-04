const TERMINAL_SELECTOR = "[data-terminal-component][data-terminal-id]";
const ASSISTANT_NOT_READY = /circuit assistant is not mounted yet/i;

function cloneEndpoint(endpoint) {
  return {
    componentId: String(endpoint.componentId),
    terminalId: String(endpoint.terminalId)
  };
}

export function createTerminalPairCommitter(options = {}) {
  const getExecuteAction = options.getExecuteAction ?? (() => null);
  const scheduleRetry = options.scheduleRetry ?? ((callback) => queueMicrotask(callback));
  let pendingEndpoint = null;

  function invoke(endpointA, endpointB, allowRetry = true) {
    const executeAction = getExecuteAction();
    if (typeof executeAction !== "function") {
      if (allowRetry) scheduleRetry(() => invoke(endpointA, endpointB, false));
      return false;
    }
    try {
      Promise.resolve(executeAction("circuits_connect_terminals", {
        endpointA,
        endpointB
      })).catch(() => {});
      return true;
    } catch (error) {
      if (allowRetry && ASSISTANT_NOT_READY.test(String(error?.message ?? error))) {
        scheduleRetry(() => invoke(endpointA, endpointB, false));
      }
      return false;
    }
  }

  return {
    accept(endpointInput) {
      const endpoint = cloneEndpoint(endpointInput);
      if (!pendingEndpoint) {
        pendingEndpoint = endpoint;
        return { paired: false, dispatched: false };
      }
      const endpointA = pendingEndpoint;
      pendingEndpoint = null;
      return {
        paired: true,
        dispatched: invoke(endpointA, endpoint)
      };
    },
    reset() {
      pendingEndpoint = null;
    }
  };
}

export function installCanonicalTerminalClickBridge(documentRef = globalThis.document, windowRef = globalThis.window) {
  if (!documentRef?.addEventListener) return () => {};
  const committer = createTerminalPairCommitter({
    getExecuteAction: () => {
      const execute = windowRef?.__circuitLabCycle4?.executeAssistantAction;
      return typeof execute === "function"
        ? (name, args) => execute(name, args)
        : null;
    }
  });

  const onClick = (event) => {
    if (event?.isTrusted !== false) return;
    const terminal = event.target?.closest?.(TERMINAL_SELECTOR);
    if (!terminal) return;
    const componentId = terminal.dataset?.terminalComponent;
    const terminalId = terminal.dataset?.terminalId;
    if (!componentId || !terminalId) return;
    committer.accept({ componentId, terminalId });
  };

  documentRef.addEventListener("click", onClick, true);
  return () => {
    committer.reset();
    documentRef.removeEventListener("click", onClick, true);
  };
}

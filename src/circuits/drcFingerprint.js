const SEVERITY_RANK = Object.freeze({ info: 1, warning: 2, error: 3 });

function stableStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function issueComponentIds(issue) {
  return stableStrings([
    ...(issue?.targets?.componentIds ?? []),
    issue?.componentId
  ]);
}

function issueEndpointKeys(issue) {
  return stableStrings((issue?.targets?.terminalRefs ?? issue?.endpoints ?? [])
    .map((endpoint) => endpoint?.componentId && endpoint?.terminalId
      ? `${endpoint.componentId}:${endpoint.terminalId}`
      : ""));
}

function issueConnectionIds(issue) {
  return stableStrings(issue?.targets?.connectionIds ?? issue?.connectionIds ?? []);
}

export function canonicalDrcIssueIdentity(issue) {
  return [
    issue?.code ?? "unknown",
    issue?.domain ?? "metadata",
    issueComponentIds(issue).join(","),
    issueEndpointKeys(issue).join(","),
    issueConnectionIds(issue).join(",")
  ].join("|");
}

export function canonicalDrcIssueFingerprint(issue) {
  return [
    canonicalDrcIssueIdentity(issue),
    issue?.severity ?? "info",
    issue?.placementRisk ?? "none"
  ].join("|");
}

export function deriveDrcFingerprintDelta(baseIssues = [], candidateIssues = []) {
  const baseByIdentity = new Map(baseIssues.map((issue) => [canonicalDrcIssueIdentity(issue), issue]));
  const added = [];
  const worsened = [];
  for (const issue of candidateIssues) {
    const identity = canonicalDrcIssueIdentity(issue);
    const base = baseByIdentity.get(identity);
    if (!base) added.push(issue);
    else if ((SEVERITY_RANK[issue.severity] ?? 0) > (SEVERITY_RANK[base.severity] ?? 0)
      || (issue.placementRisk === "electrical-hazard" && base.placementRisk !== "electrical-hazard")) {
      worsened.push(issue);
    }
  }
  const electricalHazards = [...added, ...worsened]
    .filter((issue) => issue.placementRisk === "electrical-hazard")
    .sort((left, right) => canonicalDrcIssueFingerprint(left).localeCompare(canonicalDrcIssueFingerprint(right)));
  return {
    added,
    worsened,
    electricalHazards,
    addedFingerprints: added.map(canonicalDrcIssueFingerprint).sort(),
    worsenedFingerprints: worsened.map(canonicalDrcIssueFingerprint).sort(),
    electricalHazardFingerprints: electricalHazards.map(canonicalDrcIssueFingerprint).sort()
  };
}

// Override for lightning-base-components gate stub.
// The default stub enables ALL feature flags, but some (like
// enableComboboxElementInternals) call APIs unsupported in synthetic shadow.
// Returning false keeps the safe, pre-gate behaviour which is the intended
// fallback for off-platform usage.
export default { isOpen: () => false };

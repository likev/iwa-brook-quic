/**
 * Trusted Types default policy creation for Strict IWA CSP compliance.
 */

export function initTrustedTypesPolicy() {
  if (typeof window !== 'undefined' && window.trustedTypes && window.trustedTypes.createPolicy) {
    try {
      window.trustedTypes.createPolicy('default', {
        createHTML: (string) => string,
        createScript: (string) => string,
        createScriptURL: (string) => string
      });
    } catch (e) {
      // Policy may already exist
    }
  }
}

/**
 * Safe DOM construction helpers (Zero innerHTML, strict CSP & Trusted Types safe).
 */

export class DomBuilder {
  /**
   * Create an element with classes, attributes, text, and children.
   *
   * @param {string} tag
   * @param {Object} options
   * @param {string|string[]} options.classes
   * @param {Object} options.attrs
   * @param {string} options.text
   * @param {HTMLElement[]} options.children
   * @returns {HTMLElement}
   */
  static el(tag, { classes = [], attrs = {}, text = '', children = [] } = {}) {
    const element = document.createElement(tag);

    // Classes
    const classList = Array.isArray(classes) ? classes : [classes];
    for (const c of classList) {
      if (c) element.classList.add(c);
    }

    // Attributes
    for (const [key, val] of Object.entries(attrs)) {
      if (val !== undefined && val !== null) {
        element.setAttribute(key, String(val));
      }
    }

    // Text content (Safe from XSS/Trusted Types issues)
    if (text) {
      element.textContent = text;
    }

    // Children
    for (const child of children) {
      if (child instanceof Node) {
        element.appendChild(child);
      } else if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      }
    }

    return element;
  }

  /**
   * Safely clear all child nodes from an element.
   * @param {HTMLElement} parent
   */
  static clear(parent) {
    while (parent.firstChild) {
      parent.removeChild(parent.firstChild);
    }
  }
}

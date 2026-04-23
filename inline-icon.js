// Inline 1Password icon for password and login fields
// Adds a clickable 1Password icon inside input fields, similar to Safari's integration

(function() {
  'use strict';

  const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
    <rect width="24" height="24" rx="6" fill="#1A8CFF"/>
    <text x="12" y="17" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="14" fill="white">1</text>
  </svg>`;

  const ICON_SIZE = 22;
  const ICON_MARGIN = 4;
  const PROCESSED_ATTR = 'data-op-inline-icon';

  function createIcon(inputEl) {
    if (inputEl.getAttribute(PROCESSED_ATTR)) return;
    inputEl.setAttribute(PROCESSED_ATTR, 'true');

    // Don't add to hidden, tiny, or read-only fields
    const rect = inputEl.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 20) return;
    if (inputEl.readOnly || inputEl.disabled) return;

    // Create wrapper if input isn't already in a positioned container
    const wrapper = document.createElement('div');
    wrapper.className = 'op-inline-wrapper';
    wrapper.style.cssText = 'position:relative;display:inline-block;width:' +
      (inputEl.offsetWidth ? inputEl.offsetWidth + 'px' : '100%') + ';';

    const icon = document.createElement('div');
    icon.className = 'op-inline-icon';
    icon.innerHTML = ICON_SVG;
    icon.title = '1Password – Fill login';
    icon.style.cssText = [
      'position:absolute',
      'right:' + ICON_MARGIN + 'px',
      'top:50%',
      'transform:translateY(-50%)',
      'width:' + ICON_SIZE + 'px',
      'height:' + ICON_SIZE + 'px',
      'cursor:pointer',
      'z-index:2147483647',
      'opacity:0.7',
      'transition:opacity 0.15s',
      'pointer-events:auto',
      'border-radius:4px',
      'display:flex',
      'align-items:center',
      'justify-content:center',
    ].join(';') + ';';

    icon.addEventListener('mouseenter', function() { icon.style.opacity = '1'; });
    icon.addEventListener('mouseleave', function() { icon.style.opacity = '0.7'; });

    icon.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      // Send message to background to trigger 1Password fill
      chrome.runtime.sendMessage({ command: 'fillItem', params: { url: window.location.href } });
    });

    // Insert wrapper around input
    const parent = inputEl.parentNode;
    if (parent) {
      parent.insertBefore(wrapper, inputEl);
      wrapper.appendChild(inputEl);
      wrapper.appendChild(icon);

      // Adjust input padding so text doesn't overlap the icon
      const currentPadding = parseInt(window.getComputedStyle(inputEl).paddingRight) || 0;
      inputEl.style.paddingRight = Math.max(currentPadding, ICON_SIZE + ICON_MARGIN * 2 + 4) + 'px';
    }
  }

  function isLoginField(el) {
    if (el.tagName !== 'INPUT') return false;
    const type = (el.type || '').toLowerCase();
    const name = (el.name || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    const placeholder = (el.placeholder || '').toLowerCase();

    // Password fields
    if (type === 'password') return true;

    // Username/email fields near a password field
    if (['text', 'email', 'tel', ''].includes(type)) {
      const hints = [name, id, autocomplete, placeholder].join(' ');
      if (/(user|email|login|account|username|signin|sign-in)/.test(hints)) {
        return true;
      }
      // Check if there's a password field in the same form
      const form = el.closest('form');
      if (form && form.querySelector('input[type="password"]')) {
        return true;
      }
    }
    return false;
  }

  function scanForFields(root) {
    if (!root || !root.querySelectorAll) return;
    const inputs = root.querySelectorAll('input:not([' + PROCESSED_ATTR + '])');
    inputs.forEach(function(input) {
      if (isLoginField(input)) {
        // Delay slightly to ensure the input is fully rendered
        setTimeout(function() { createIcon(input); }, 100);
      }
    });
  }

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { scanForFields(document); });
  } else {
    scanForFields(document);
  }

  // Watch for dynamically added fields (SPAs, lazy-loaded forms)
  const observer = new MutationObserver(function(mutations) {
    for (let i = 0; i < mutations.length; i++) {
      const mutation = mutations[i];
      for (let j = 0; j < mutation.addedNodes.length; j++) {
        const node = mutation.addedNodes[j];
        if (node.nodeType === 1) {
          if (node.tagName === 'INPUT' && isLoginField(node)) {
            setTimeout(function() { createIcon(node); }, 100);
          } else {
            scanForFields(node);
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

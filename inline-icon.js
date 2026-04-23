// Inline 1Password icon for password and login fields
// Adds a clickable 1Password icon inside input fields that triggers the toolbar fill action

(function() {
  'use strict';

  const ICON_SIZE = 20;
  const ICON_MARGIN = 6;
  const PROCESSED_ATTR = 'data-op-inline-icon';

  // Use the extension's own icon
  const ICON_URL = chrome.runtime.getURL('assets/Icon-16.png');

  function createIcon(inputEl) {
    if (inputEl.getAttribute(PROCESSED_ATTR)) return;
    inputEl.setAttribute(PROCESSED_ATTR, 'true');

    // Don't add to hidden, tiny, or read-only fields
    const rect = inputEl.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 20) return;
    if (inputEl.readOnly || inputEl.disabled) return;
    if (window.getComputedStyle(inputEl).visibility === 'hidden') return;
    if (window.getComputedStyle(inputEl).display === 'none') return;

    const icon = document.createElement('img');
    icon.src = ICON_URL;
    icon.className = 'op-inline-icon';
    icon.title = '1Password – Fill login';
    icon.setAttribute('tabindex', '-1');

    // Position the icon inside the input field using absolute positioning
    icon.style.cssText = [
      'position:absolute',
      'width:' + ICON_SIZE + 'px',
      'height:' + ICON_SIZE + 'px',
      'cursor:pointer',
      'z-index:2147483647',
      'opacity:0.65',
      'transition:opacity 0.15s',
      'pointer-events:auto',
      'padding:0',
      'margin:0',
      'border:none',
      'background:none',
      'box-shadow:none',
      'outline:none',
    ].join(';') + ';';

    icon.addEventListener('mouseenter', function() { icon.style.opacity = '1'; });
    icon.addEventListener('mouseleave', function() { icon.style.opacity = '0.65'; });

    icon.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);

    icon.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // Tell the background to trigger the same action as clicking the toolbar button
      chrome.runtime.sendMessage({ command: 'inline-icon-clicked', params: { url: window.location.href } });
      return false;
    }, true);

    // Add padding to input so text doesn't overlap the icon
    const currentPadding = parseInt(window.getComputedStyle(inputEl).paddingRight) || 0;
    inputEl.style.paddingRight = Math.max(currentPadding, ICON_SIZE + ICON_MARGIN * 2 + 2) + 'px';

    // Position the icon relative to the input
    const parent = inputEl.parentNode;
    if (!parent) return;

    // Make parent relative if it isn't already positioned
    const parentPosition = window.getComputedStyle(parent).position;
    if (parentPosition === 'static') {
      parent.style.position = 'relative';
    }

    parent.insertBefore(icon, inputEl.nextSibling);
    positionIcon(inputEl, icon);

    // Reposition on window resize
    let resizeTimer;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() { positionIcon(inputEl, icon); }, 100);
    });
  }

  function positionIcon(inputEl, icon) {
    const inputRect = inputEl.getBoundingClientRect();
    const parentRect = inputEl.parentNode.getBoundingClientRect();

    icon.style.top = (inputEl.offsetTop + (inputEl.offsetHeight - ICON_SIZE) / 2) + 'px';
    icon.style.left = (inputEl.offsetLeft + inputEl.offsetWidth - ICON_SIZE - ICON_MARGIN) + 'px';
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
    var inputs = root.querySelectorAll('input:not([' + PROCESSED_ATTR + '])');
    for (var i = 0; i < inputs.length; i++) {
      if (isLoginField(inputs[i])) {
        (function(input) {
          setTimeout(function() { createIcon(input); }, 150);
        })(inputs[i]);
      }
    }
  }

  // Check for empty password fields and try auto-fill from background cache.
  // This handles full page navigations (e.g., username form submits to a new page
  // that has the password field already in the DOM on load).
  function tryAutoFillOnLoad() {
    if (autoFillAttempted) return;
    var pwFields = document.querySelectorAll('input[type="password"]');
    for (var i = 0; i < pwFields.length; i++) {
      var field = pwFields[i];
      if (!field.value && !field.disabled && !field.readOnly &&
          field.getBoundingClientRect().height > 0) {
        autoFillPasswordField(field);
        return;
      }
    }
  }

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      scanForFields(document);
      // Delay auto-fill check to let the page settle
      setTimeout(tryAutoFillOnLoad, 800);
    });
  } else {
    scanForFields(document);
    setTimeout(tryAutoFillOnLoad, 800);
  }

  // --- Auto-fill for two-step logins ---
  // When a password field appears dynamically after the username was filled,
  // the background has set up a Go & Fill operation via OnePassword.trackGoAndFillOperationForTabReference.
  // We just need to trigger the content script's checkForGoAndFill scan, which is done by
  // the existing injected.min.js code. We signal it by briefly waiting (the background's
  // Go & Fill tracking will handle the auto-fill via the existing 1Password flow).
  var autoFillTimer = null;
  var autoFillAttempted = false;

  function autoFillPasswordField(field) {
    if (autoFillAttempted) return;
    autoFillAttempted = true;
    // The Go & Fill mechanism in 1Password works via the toolbar button handler.
    // When Go & Fill is tracked for a tab, clicking the toolbar button auto-fills
    // without showing the popup. Trigger it.
    chrome.runtime.sendMessage({ command: 'inline-icon-clicked', params: { url: window.location.href } });
  }

  // Watch for dynamically added fields (SPAs, lazy-loaded forms)
  var observer = new MutationObserver(function(mutations) {
    var hasNewPasswordField = false;
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType === 1) {
          if (node.tagName === 'INPUT') {
            if (isLoginField(node)) {
              (function(n) { setTimeout(function() { createIcon(n); }, 150); })(node);
            }
            if ((node.type || '').toLowerCase() === 'password') {
              hasNewPasswordField = true;
            }
          } else {
            scanForFields(node);
            if (node.querySelector && node.querySelector('input[type="password"]')) {
              hasNewPasswordField = true;
            }
          }
        }
      }
    }

    // If a new password field appeared dynamically, try auto-fill after a short delay
    if (hasNewPasswordField && !autoFillAttempted) {
      clearTimeout(autoFillTimer);
      autoFillTimer = setTimeout(function() {
        var pwFields = document.querySelectorAll('input[type="password"]');
        for (var k = 0; k < pwFields.length; k++) {
          var field = pwFields[k];
          if (!field.value && !field.disabled && !field.readOnly &&
              field.getBoundingClientRect().height > 0) {
            autoFillPasswordField(field);
            break;
          }
        }
      }, 500);
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

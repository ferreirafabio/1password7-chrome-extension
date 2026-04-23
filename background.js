// 1Password Extension - Manifest V3 Service Worker
// Shims MV2 APIs for compatibility with the original 1Password background code in global.min.js

// Shim window -> self for service worker context
if (typeof window === 'undefined') {
  self.window = self;
}

// Shim chrome.browserAction -> chrome.action (MV2 -> MV3)
// Capture the toolbar click handler so the inline icon can reuse it.
self._opToolbarHandler = null;
if (typeof chrome !== 'undefined' && chrome.action && !chrome.browserAction) {
  chrome.browserAction = chrome.action;

  // Wrap onClicked.addListener to capture the handler
  var origOnClickedAddListener = chrome.action.onClicked.addListener.bind(chrome.action.onClicked);
  chrome.action.onClicked.addListener = function(handler) {
    self._opToolbarHandler = handler;
    origOnClickedAddListener(handler);
  };
}

// Shim chrome.webRequest.onBeforeRequest to replace MV2 blocking mode.
// In MV2, the listener returned {redirectUrl} to redirect. In MV3, blocking is forbidden.
// Instead, we run the original callback, check if it returns {redirectUrl}, and perform
// the redirect via chrome.tabs.update(). This is critical for Go & Fill (two-step logins).
if (typeof chrome !== 'undefined' && chrome.webRequest) {
  var origOnBeforeRequest = chrome.webRequest.onBeforeRequest;
  if (origOnBeforeRequest) {
    var origWrAddListener = origOnBeforeRequest.addListener.bind(origOnBeforeRequest);
    origOnBeforeRequest.addListener = function(callback, filter, extraInfoSpec) {
      if (Array.isArray(extraInfoSpec) && extraInfoSpec.indexOf('blocking') !== -1) {
        // Strip 'blocking' but wrap callback to handle redirects manually
        extraInfoSpec = extraInfoSpec.filter(function(s) { return s !== 'blocking'; });
        if (extraInfoSpec.length === 0) extraInfoSpec = undefined;

        var wrappedCallback = function(details) {
          var result = callback(details);
          if (result && result.redirectUrl && details.tabId > 0) {
            chrome.tabs.update(details.tabId, { url: result.redirectUrl });
          }
          return result;
        };
        origWrAddListener(wrappedCallback, filter, extraInfoSpec);
      } else {
        origWrAddListener(callback, filter, extraInfoSpec);
      }
    };
  }
}

// Shim chrome.contextMenus.create to support MV2-style onclick handlers.
// MV3 requires an 'id' parameter and uses onClicked listener instead of inline onclick.
if (typeof chrome !== 'undefined' && chrome.contextMenus) {
  var origCreate = chrome.contextMenus.create.bind(chrome.contextMenus);
  var onclickHandlers = {};
  var menuCounter = 0;

  chrome.contextMenus.create = function(createProperties, callback) {
    if (!createProperties.id) {
      createProperties.id = '1password-menu-' + (++menuCounter);
    }
    var onclick = createProperties.onclick;
    if (onclick) {
      delete createProperties.onclick;
      onclickHandlers[createProperties.id] = onclick;
    }
    return origCreate(createProperties, callback);
  };

  chrome.contextMenus.onClicked.addListener(function(info, tab) {
    var handler = onclickHandlers[info.menuItemId];
    if (handler) {
      handler(info, tab);
    }
  });
}

// Cache fill scripts per tab and suppress "Receiving end does not exist" errors.
// When 1Password sends a fill script to a tab, we cache it so we can replay it
// when a password field appears dynamically (two-step login flows).
self._lastFillScript = {};
if (typeof chrome !== 'undefined' && chrome.tabs) {
  var origTabsSendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
  chrome.tabs.sendMessage = function(tabId, message, optionsOrCallback, callback) {
    // Cache executeFillScript messages per tab for replay
    if (message && (message.name === 'executeFillScript' || message.name === 'legacy_executeFillScript')) {
      self._lastFillScript[tabId] = message;
    }

    if (typeof optionsOrCallback === 'function') {
      callback = optionsOrCallback;
      optionsOrCallback = undefined;
    }
    var wrappedCallback = function() {
      if (chrome.runtime.lastError) { /* suppress */ }
      if (callback) callback.apply(this, arguments);
    };
    if (optionsOrCallback) {
      return origTabsSendMessage(tabId, message, optionsOrCallback, wrappedCallback);
    }
    return origTabsSendMessage(tabId, message, wrappedCallback);
  };

  // Clean up cache when tabs are closed
  chrome.tabs.onRemoved.addListener(function(tabId) {
    delete self._lastFillScript[tabId];
  });
}

// Handle inline icon clicks and password extraction BEFORE global.min.js loads its listener.
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (!message || !sender.tab) return;

  if (message.command === 'inline-icon-clicked') {
    if (self._opToolbarHandler) {
      self._opToolbarHandler(sender.tab);
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.command === 'get-cached-password') {
    // Content script is asking for the cached password value for this tab.
    var tabId = sender.tab.id;
    var cached = self._lastFillScript[tabId];
    var password = null;

    if (cached && cached.message) {
      var msg = cached.message;
      var script = msg.script;
      var props = msg.properties;

      // Try to find the password value from the fill script.
      // Method 1: Use properties to identify password fields, then get their values from script
      if (props && script) {
        // props contains field metadata keyed by opid
        var passwordOpids = [];
        var keys = Object.keys(props);
        for (var i = 0; i < keys.length; i++) {
          var field = props[keys[i]];
          if (field && (field.type === 'password' ||
              (field.htmlInputType && field.htmlInputType === 'password') ||
              (field.designationType && field.designationType === 'password'))) {
            passwordOpids.push(keys[i]);
          }
        }

        // Now find the value for these opids in the script
        for (var j = 0; j < script.length; j++) {
          var entry = script[j];
          var op, target, value;
          if (Array.isArray(entry)) {
            op = entry[0]; target = entry[1]; value = entry[2];
          } else if (entry && typeof entry === 'object') {
            op = entry.action || entry.operation || '';
            var vals = entry.values || entry.parameters || [];
            target = vals[0]; value = vals[1];
          }
          if (value && typeof value === 'string' && op && typeof op === 'string' && op.indexOf('fill') === 0) {
            if (passwordOpids.length > 0 && passwordOpids.indexOf(target) !== -1) {
              password = value;
              break;
            }
          }
        }
      }

      // Method 2: If no password found via properties, use heuristic —
      // collect all fill values and pick the one not matching any visible input
      if (!password && script) {
        var allValues = [];
        for (var k = 0; k < script.length; k++) {
          var e = script[k];
          var v;
          if (Array.isArray(e)) {
            v = e.length >= 3 ? e[2] : null;
            if (v && typeof v === 'string' && e[0] && typeof e[0] === 'string' && e[0].indexOf('fill') === 0) {
              allValues.push(v);
            }
          } else if (e && typeof e === 'object') {
            var vs = e.values || e.parameters || [];
            v = vs[1];
            var o = e.action || e.operation || '';
            if (v && typeof v === 'string' && o.indexOf('fill') === 0) {
              allValues.push(v);
            }
          }
        }
        // Send all values — content script will determine which is the password
        if (allValues.length > 0) {
          sendResponse({ values: allValues });
          return true;
        }
      }
    }

    sendResponse({ password: password, values: null });
    return true;
  }
});

// Import the SJCL crypto library (used by the 1Password background logic)
importScripts('ext/sjcl.js');

// Import the original 1Password background logic
importScripts('global.min.js');

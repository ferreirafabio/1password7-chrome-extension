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

// Suppress "Receiving end does not exist" errors and cache fill scripts.
// Store raw fill script in chrome.storage.local so content scripts can read it
// directly — survives service worker restarts and avoids message passing issues.
if (typeof chrome !== 'undefined' && chrome.tabs) {
  var origTabsSendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
  chrome.tabs.sendMessage = function(tabId, message, optionsOrCallback, callback) {
    // Cache entire fill script message in storage for content script to read
    if (message && (message.name === 'executeFillScript' || message.name === 'legacy_executeFillScript')) {
      try {
        var scriptData = JSON.stringify(message);
        var obj = {};
        obj['fill_' + tabId] = scriptData;
        obj['fill_ts_' + tabId] = Date.now();
        chrome.storage.local.set(obj);
        console.log('[1P-shim] Cached fill script for tab ' + tabId + ', size: ' + scriptData.length);
      } catch(e) {
        console.log('[1P-shim] Failed to cache fill script:', e);
      }
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
    chrome.storage.local.remove(['fill_' + tabId, 'fill_ts_' + tabId]);
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

});

// Import the SJCL crypto library (used by the 1Password background logic)
importScripts('ext/sjcl.js');

// Import the original 1Password background logic
importScripts('global.min.js');

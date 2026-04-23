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

// Cache fill script values per tab and suppress "Receiving end does not exist" errors.
// Extract ALL string values from fill scripts so we can auto-fill password fields
// that appear dynamically in two-step login flows.
self._lastFillScript = {};
if (typeof chrome !== 'undefined' && chrome.tabs) {
  // Recursively extract all string values from any data structure
  function extractStrings(obj, results) {
    if (!obj) return;
    if (typeof obj === 'string' && obj.length > 0 && obj.length < 500) {
      results.push(obj);
    } else if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) extractStrings(obj[i], results);
    } else if (typeof obj === 'object') {
      var keys = Object.keys(obj);
      for (var j = 0; j < keys.length; j++) extractStrings(obj[keys[j]], results);
    }
  }

  var origTabsSendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
  chrome.tabs.sendMessage = function(tabId, message, optionsOrCallback, callback) {
    // Cache fill script values per tab
    if (message && (message.name === 'executeFillScript' || message.name === 'legacy_executeFillScript')) {
      var msg = message.message;
      if (msg && msg.script) {
        // Extract all string values from the script entries
        var allValues = [];
        extractStrings(msg.script, allValues);
        // Filter out operation names and common non-value strings
        var ops = ['fill_by_opid','fill_by_query','click_on_opid','click_on_query',
                   'focus_by_opid','touch_all_fields','simple_set_value_by_query',
                   'delay','fopid','fq','copid','cq','focusopid','mb',
                   'fill_by_opid_and_submit'];
        var filtered = [];
        for (var i = 0; i < allValues.length; i++) {
          var v = allValues[i];
          if (ops.indexOf(v) === -1 && v.indexOf('__') !== 0 && v !== 'true' && v !== 'false') {
            filtered.push(v);
          }
        }
        self._lastFillScript[tabId] = filtered;
        // Persist across service worker restarts
        var storageObj = {};
        storageObj['fill_' + tabId] = filtered;
        chrome.storage.session.set(storageObj);
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
    delete self._lastFillScript[tabId];
    chrome.storage.session.remove('fill_' + tabId);
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
    // Content script is asking for cached fill values for this tab.
    var tabId = sender.tab.id;
    var cached = self._lastFillScript[tabId];

    if (cached && cached.length > 0) {
      sendResponse({ values: cached });
      return true;
    }

    // Service worker may have restarted — check persistent storage
    chrome.storage.session.get('fill_' + tabId, function(result) {
      var stored = result['fill_' + tabId];
      if (stored && stored.length > 0) {
        sendResponse({ values: stored });
      } else {
        sendResponse({ values: null });
      }
    });
    return true; // Keep channel open for async response
  }
});

// Import the SJCL crypto library (used by the 1Password background logic)
importScripts('ext/sjcl.js');

// Import the original 1Password background logic
importScripts('global.min.js');

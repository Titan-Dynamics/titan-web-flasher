import {transport} from './transport.js'

export function infoAlert(title, message) {
  return cuteAlert({ type: 'info', title, message })
}
export function errorAlert(title, message) {
  return cuteAlert({ type: 'error', title, message })
}

// Save settings that only take effect at boot: confirm up front, then save and reboot without a
// second prompt. Cancelling leaves the device untouched — nothing is written. The button that
// triggers this reads "Save & Reboot", so the confirmation is never a surprise.
export function saveAndReboot(title, errorTitle, saveFn, changes, successCB, {
  message = 'These settings are applied when the device boots. Save them and reboot now?',
  confirmText = 'Save & Reboot',
} = {}) {
  return cuteAlert({
    type: 'question',
    title,
    message,
    confirmText,
    cancelText: 'Cancel',
  }).then((res) => {
    if (res !== 'confirm') return
    return Promise.resolve()
      .then(() => saveFn(changes))
      .then(() => {
        if (successCB) successCB()
        // fire-and-forget reboot
        Promise.resolve(transport.reboot()).catch(() => {})
      })
      .catch(async (err) => {
        await errorAlert(errorTitle, (err && err.message) || 'Request failed')
      })
  })
}

// Run a save action (a function returning a Promise, normally a transport method) and then
// show the reboot prompt on success. `saveFn` replaces what used to be a hard-coded URL, which
// is what lets the same panels run over HTTP on-device and over WebUSB in the web flasher.
export function saveWithReboot(title, errorTitle, saveFn, changes, successCB) {
  return Promise.resolve()
    .then(() => saveFn(changes))
    .then(async () => {
      let message
      if (successCB) message = successCB()
      const res = await cuteAlert({
        type: 'question',
        title,
        message: message || 'Reboot to take effect',
        confirmText: 'Reboot',
        cancelText: 'Close',
      })
      if (res === 'confirm') {
        Promise.resolve(transport.reboot()).catch(() => {})
      }
    })
    .catch(async (err) => {
      await errorAlert(errorTitle, (err && err.message) || 'Request failed')
    })
}

// Confirm a destructive action first, then run it with no success popup — the visible outcome (a
// reboot, a re-render) is the feedback. Failures still surface. Cancelling does nothing at all.
export function actionWithConfirm(title, message, confirmText, errorTitle, actionFn) {
  return function (e) {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    return cuteAlert({type: 'question', title, message, confirmText, cancelText: 'Cancel'})
      .then((res) => {
        if (res !== 'confirm') return
        return Promise.resolve()
          .then(() => actionFn())
          .catch(async (err) => {
            await errorAlert(errorTitle, (err && err.message) || 'Request failed')
          })
      })
  }
}

// Click handler that runs a transport action and reports the outcome.
export function actionWithFeedback(title, errorMsg, actionFn, success) {
  return function (e) {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }
    return Promise.resolve()
      .then(() => actionFn())
      .then(async (responseText) => {
        if (success) success()
        await infoAlert(title, responseText || 'Done')
      })
      .catch(async () => {
        await errorAlert(title, errorMsg)
      })
  }
}

/*
 * NOTE (dashboard copy): the URL/XHR-based helpers from the firmware copy of this file
 * (post/postJSON/saveJSONWithReboot/postWithFeedback) are deliberately removed. They only serve
 * the ESP-only panels that were not ported, and the dashboard must contain no direct HTTP.
 * See PORTING.md.
 */

export function cuteAlert({
  type,
  title,
  message,
  buttonText = 'OK',
  confirmText = 'OK',
  cancelText = 'Cancel',
}) {
  return new Promise((resolve) => {
    const headerClass = {
      error: 'is-error', success: 'is-success', info: 'is-info',
      question: 'is-question', warn: 'is-warn'
    }[type] || 'is-info'

    const iconName = {
      error: 'activity', success: 'activity', info: 'info',
      question: 'bell', warn: 'bell'
    }[type] || 'info'

    const actions = type === 'question'
      ? `<button class="td-btn td-btn-danger td-alert-confirm">${confirmText}</button>
         <button class="td-btn td-alert-cancel">${cancelText}</button>`
      : `<button class="td-btn td-btn-primary td-alert-ok">${buttonText}</button>`

    const wrapper = document.createElement('div')
    wrapper.className = 'td-alert-backdrop'
    wrapper.innerHTML = `
<div class="td-alert-card">
  <div class="td-alert-header ${headerClass}">
    <span class="td-h4">${title}</span>
    <button class="td-alert-close" aria-label="Close">&times;</button>
  </div>
  <div class="td-alert-body">
    <span class="td-alert-message">${message}</span>
    <div class="td-alert-actions">${actions}</div>
  </div>
</div>`

    // DASHBOARD DIVERGENCE (see PORTING.md substitution 7): this copy of td-extensions.css has
    // every selector prefixed with `.td-dashboard`, so an alert appended to document.body gets
    // none of its styling — no `position: fixed`, no backdrop — and lands as a static block below
    // the fixed full-viewport shell, i.e. invisible and unclickable. Mount it inside the
    // dashboard container so the ported styles apply.
    const alertHost = document.querySelector('.td-dashboard') || document.body
    alertHost.appendChild(wrapper)

    const card = wrapper.querySelector('.td-alert-card')

    function resolveIt() { wrapper.remove(); resolve() }
    function confirmIt() { wrapper.remove(); resolve('confirm') }

    wrapper.querySelector('.td-alert-close').addEventListener('click', resolveIt)
    wrapper.addEventListener('click', resolveIt)
    card.addEventListener('click', e => e.stopPropagation())

    if (type === 'question') {
      wrapper.querySelector('.td-alert-confirm').addEventListener('click', confirmIt)
      wrapper.querySelector('.td-alert-cancel').addEventListener('click', resolveIt)
    } else {
      wrapper.querySelector('.td-alert-ok').addEventListener('click', resolveIt)
    }
  })
}

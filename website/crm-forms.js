// Drop-in for the Wastely website (ny7fdnr79t-bit/Wastely).
// Every form currently POSTs JSON to https://formsubmit.co/ajax/go@wastely.ca from its onSubmit.
// Keep that call (email copy) and add this one next to it, passing the same `d` object and a form name.
//
//   sendToCrm(d, 'Quote request');   // QuoteForm.dc.html, ServicePage.dc.html, Wastely.dc.html
//   sendToCrm(d, 'Contact');         // Contact.dc.html
//   sendToCrm(d, 'Careers');         // Careers.dc.html
//
// Add a hidden honeypot input to each form:  <input name="_gotcha" tabindex="-1" autocomplete="off" style="display:none">
// The CRM endpoint rejects any submission where _gotcha is filled.

window.sendToCrm = function (d, form) {
  var CRM_URL = 'https://crm.wastely.ca/api/forms'; // replace with your deployed CRM URL
  try {
    fetch(CRM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form: form, page: location.href, submittedAt: new Date().toISOString(), fields: d }),
      keepalive: true
    }).catch(function () {});
  } catch (e) {}
};

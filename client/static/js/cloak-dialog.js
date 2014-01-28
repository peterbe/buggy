var dialog = document.querySelector('dialog');
dialogPolyfill.registerDialog(dialog);

function showCloakDialog(msg) {
  dialog.querySelector('span').textContent = msg;
  if (!dialog.open) {
    dialog.showModal();
  }
}
function closeCloakDialog() {
  if (dialog.open) {
    dialog.close();
  }
}

showCloakDialog('Loading app...');

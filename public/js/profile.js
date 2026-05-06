const saveButton = document.getElementById('save-contact');

if (saveButton) {
  saveButton.addEventListener('click', () => {
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Amina Johnson',
      'ORG:Ashar NFC',
      'TITLE:Founder',
      'TEL;TYPE=CELL:+1-555-0100',
      'EMAIL:hello@ashar.nfc',
      'END:VCARD',
    ].join('\n');

    const blob = new Blob([vcard], { type: 'text/vcard' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'Ashar-Contact.vcf';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 0);
  });
}

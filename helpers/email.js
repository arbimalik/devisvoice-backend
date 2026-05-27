// Tous les emails partent depuis devis@devisvoice.fr
// L'artisan apparaît comme expéditeur via le "from name"
async function sendEmail({ artisanNom, artisanEmail, to, subject, html, attachments }) {
  const fromName = artisanNom ? `${artisanNom} via DevisVoice` : 'DevisVoice';
  const payload = {
    from: `${fromName} <devis@devisvoice.fr>`,
    reply_to: artisanEmail || 'contact@devisvoice.fr',
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  };
  if (attachments && attachments.length) {
    payload.attachments = attachments.map(a => ({
      ...a,
      content_type: a.content_type || 'application/pdf'
    }));
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Erreur envoi email');
  return data;
}

module.exports = { sendEmail };

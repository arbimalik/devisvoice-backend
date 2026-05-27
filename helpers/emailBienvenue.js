function buildEmailBienvenue(prenom) {
  const nom = prenom ? prenom : 'là';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
body,table,td,p,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
body{margin:0;padding:0;background:#e8e0d5;}
@media only screen and (max-width:620px){
  .email-wrap{width:100%!important;}
  .pad{padding-left:20px!important;padding-right:20px!important;}
  .pad-hero{padding:24px 20px 30px!important;}
  .pad-features{padding:28px 20px!important;}
  .pad-footer{padding:20px!important;}
  .hero-title{font-size:24px!important;line-height:1.25!important;}
  .hero-sub{font-size:13px!important;}
  .cta-cell{padding:0 20px 30px!important;}
}
</style>
</head>
<body style="margin:0;padding:24px 16px;background:#e8e0d5;">
<table width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center">
<table class="email-wrap" cellpadding="0" cellspacing="0" border="0"
  style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

  <!-- HEADER -->
  <tr>
    <td class="pad" style="background:#1a1510;padding:26px 40px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td><span style="font-family:Arial,sans-serif;font-size:22px;font-weight:800;color:#f0ede8;letter-spacing:-0.5px;">Devis<span style="color:#FF4500;">Voice</span></span></td>
        <td align="right"><span style="font-family:Arial,sans-serif;font-size:10px;color:rgba(255,255,255,0.3);letter-spacing:0.8px;text-transform:uppercase;">Bienvenue</span></td>
      </tr></table>
    </td>
  </tr>

  <!-- HERO -->
  <tr>
    <td class="pad-hero" style="background:#1a1510;padding:4px 40px 36px;">
      <div style="width:40px;height:3px;background:#FF4500;border-radius:2px;margin-bottom:20px;"></div>
      <p class="hero-title" style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:28px;font-weight:800;color:#f0ede8;line-height:1.2;letter-spacing:-0.5px;">
        Ton compte est prêt,<br><span style="color:#FF4500;">${nom}&nbsp;!</span>
      </p>
      <p class="hero-sub" style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:rgba(255,255,255,0.5);line-height:1.65;">
        DevisVoice est là pour te faire gagner des heures chaque semaine.<br>
        Dicte, génère, envoie — tout depuis ton téléphone.
      </p>
    </td>
  </tr>

  <!-- CTA -->
  <tr>
    <td class="cta-cell" style="background:#1a1510;padding:0 40px 40px;">
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:#FF4500;border-radius:10px;">
          <a href="https://devisvoice.fr" style="display:inline-block;padding:13px 28px;font-family:Arial,sans-serif;font-size:14px;font-weight:800;color:#fff;text-decoration:none;letter-spacing:0.2px;white-space:nowrap;">
            Accéder à DevisVoice &rarr;
          </a>
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- FONCTIONNALITÉS -->
  <tr>
    <td class="pad-features" style="background:#fff;padding:32px 40px;">
      <p style="margin:0 0 22px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;color:#aaa;letter-spacing:1.2px;text-transform:uppercase;">Ce que tu peux faire dès maintenant</p>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;"><tr>
        <td width="50" valign="top" style="padding-top:2px;"><div style="width:40px;height:40px;background:rgba(255,69,0,0.08);border-radius:10px;text-align:center;line-height:40px;font-size:20px;">🎙️</div></td>
        <td style="padding-left:14px;" valign="top">
          <p style="margin:0 0 3px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#1a1a1a;">Dicte tes devis à la voix</p>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#888;line-height:1.55;">Parle naturellement, DevisVoice structure tout automatiquement.</p>
        </td>
      </tr></table>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;"><tr>
        <td width="50" valign="top" style="padding-top:2px;"><div style="width:40px;height:40px;background:rgba(255,69,0,0.08);border-radius:10px;text-align:center;line-height:40px;font-size:20px;">📋</div></td>
        <td style="padding-left:14px;" valign="top">
          <p style="margin:0 0 3px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#1a1a1a;">Génère un PDF pro en 30 secondes</p>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#888;line-height:1.55;">Devis, bon de commande, facture — directement depuis l'appli.</p>
        </td>
      </tr></table>

      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="50" valign="top" style="padding-top:2px;"><div style="width:40px;height:40px;background:rgba(255,69,0,0.08);border-radius:10px;text-align:center;line-height:40px;font-size:20px;">📤</div></td>
        <td style="padding-left:14px;" valign="top">
          <p style="margin:0 0 3px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#1a1a1a;">Envoie directement à ton client</p>
          <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#888;line-height:1.55;">Email avec PDF joint, en un clic depuis le chantier.</p>
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td class="pad-footer" style="background:#f0ebe3;padding:22px 40px;border-radius:0 0 16px 16px;">
      <p style="margin:0 0 5px;font-family:Arial,sans-serif;font-size:13px;font-weight:800;color:#1a1510;">Devis<span style="color:#FF4500;">Voice</span></p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#bbb;line-height:1.7;">
        Tu reçois cet email car tu viens de créer un compte sur DevisVoice.<br>
        <a href="https://devisvoice.fr" style="color:#FF4500;text-decoration:none;">devisvoice.fr</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = { buildEmailBienvenue };

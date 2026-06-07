export async function sendEmail({ serviceId, templateId, publicKey, privateKey, templateParams }) {
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: templateParams,
    }),
  });

  const body = await res.text();
  console.log(`EmailJS response: ${res.status} ${body}`);

  if (!res.ok) {
    throw new Error(`EmailJS failed: ${res.status} ${body}`);
  }

  return body;
}

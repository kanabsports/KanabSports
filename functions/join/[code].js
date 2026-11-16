// A branded shortcut only. Parent sign-in and membership checks remain in the portal.
export function onRequestGet({request,params}) {
  const code = String(params.code || '').toUpperCase();
  if (!/^[A-Z0-9_-]{1,32}$/.test(code)) return new Response('Invalid team link. Ask your coach for a new invitation.',{status:400});
  const destination = new URL('/family/',request.url);
  destination.searchParams.set('code',code);
  return Response.redirect(destination.href,302);
}

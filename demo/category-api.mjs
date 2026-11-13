// Synthetic portfolio-only category color API. No server/account access.
export function createCategoryApi({companyId, projects, tags, initial = {}, save = () => {}}) {
 const colors = Object.fromEntries([...projects.map(x=>({kind:'project',targetId:x.id,color:null,version:null})),...tags.map(x=>({kind:'tag',targetId:x.id,color:null,version:null}))].map(x=>[`${x.kind}:${x.targetId}`,x]));Object.assign(colors,structuredClone(initial));
 const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}});
 const prefix = `/api/companies/${companyId}/category-colors`;
 return { colors, handle(path, method, body = {}) {
  if (path === prefix && method === 'GET') return json({companyId, items:Object.values(colors)});
  if (!path.startsWith(prefix + '/')) return null;
  const [kind, targetId, extra] = path.slice(prefix.length + 1).split('/');
  if (method !== 'PUT' || extra || !['project','tag'].includes(kind)) return json({code:'DEMO_UNSUPPORTED'},405);
  if (!(kind === 'project' ? projects : tags).some(x => x.id === targetId)) return json({code:'NOT_FOUND'},404);
  const key = `${kind}:${targetId}`;
  const old = colors[key] || {version:null};
  if (body.version !== old.version) return json({code:'VERSION_CONFLICT'},409);
  if (body.color !== null && (typeof body.color !== 'string' || !/^#[a-f\d]{6}$/i.test(body.color))) return json({code:'VALIDATION_FAILED'},400);
  colors[key] = {kind,targetId,color:body.color,version:(old.version || 0) + 1};
  save(colors);
  return json(colors[key]);
 }};
}

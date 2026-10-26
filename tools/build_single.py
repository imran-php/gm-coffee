from pathlib import Path
import re,base64,hashlib,sys
root=Path(__file__).resolve().parents[1]
cache={}
def data_uri(path):
 if path not in cache:
  raw=(root/path).read_bytes();typ='image/svg+xml' if path.endswith('.svg') else 'image/png'
  cache[path]='data:'+typ+';base64,'+base64.b64encode(raw).decode()
 return cache[path]
def assets(s):
 return re.sub(r'assets/[a-zA-Z0-9/_-]+\.(?:svg|png|webp)',lambda m:data_uri(m.group()),s)
html=(root/'index.html').read_text()
html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>','',html)
html=re.sub(r'\s*<script src="js/[^\"]+" defer></script>','',html)
style='\n'+(root/'css/styles.css').read_text()+'\n'
html=html.replace('<link rel="stylesheet" href="css/styles.css">','<style>'+style+'</style>')
scripts=['\n'+assets((root/f'js/{name}.js').read_text())+'\n' for name in ['config','menu','core','app']]
def h(s): return "'sha256-"+base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()+"'"
csp="default-src 'none'; script-src "+' '.join(h(s) for s in scripts)+"; style-src "+h(style)+"; img-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
html=html.replace('<head>','<head>\n  <meta http-equiv="Content-Security-Policy" content="'+csp+'">')
html=assets(html)
html=html.replace('</body>', '\n'.join('<script>'+s+'</script>' for s in scripts)+'\n</body>')
output=Path(sys.argv[1]) if len(sys.argv)>1 else root.parent/'gm-coffee-preview.html'
output.write_text(html,encoding='utf-8')
print('Standalone:',len(html.encode()),'bytes',len(cache),'embedded images')

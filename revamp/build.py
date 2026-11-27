#!/usr/bin/env python3
"""Builds one-file, 4-page website revamp concepts with a before/after slider.
Each company dict holds only facts found on the company's own site or public listings."""
import html, json, os

OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)
e = lambda s: html.escape(str(s), quote=True)

COMPANIES = [
 dict(
  slug="dhabi-contracting", name="Dhabi Contracting", legal="Dhabi Contracting LLC",
  site="https://dhabicontracting.com/", segment="Construction",
  logo="https://dhabicontracting.com/wp-content/uploads/2022/03/logo.png",
  theme=dict(bg="#0F1214", ink="#F3F1EC", panel="#1A1F23", accent="#F2A900", accent2="#E0E4E7", muted="#9AA3AA",
             head="'Archivo', sans-serif", body="'Inter', sans-serif",
             fonts="Archivo:wght@500;700;900&family=Inter:wght@400;500;600"),
  hero_kicker="Special Category contractor · Abu Dhabi since 1983",
  hero_title="Building the UAE's landmarks, turnkey, for over 40 years.",
  hero_sub="Civil engineering and electro-mechanical works delivered in-house, from piling and foundations to hand-over, for government, developers and industry.",
  cta="Request a tender meeting",
  stats=[("1983","Founded"),("210+","Projects delivered*"),("Special","Category classification"),("2","Branches: Abu Dhabi & Dubai")],
  stat_note="*As stated on the current website.",
  about_title="One team from design to hand-over",
  about=["Dhabi Contracting LLC was established in 1983 as a 'Special Category' contractor in the UAE, built by a team of engineers and support staff with long track records in the country.",
         "The company undertakes diversified turnkey construction projects with in-house capabilities for specialised jobs in civil engineering and electro-mechanical engineering, across industrial, commercial, institutional, high-rise residential, luxury villa and sewerage projects.",
         "It owns a large inventory of construction machinery and equipment, which keeps critical work on its own schedule."],
  timeline=[("1983","Founded in Abu Dhabi as a Special Category contractor"),("1984","Al Ain Luxurious Villas for the Government of Abu Dhabi"),("2003","Abu Dhabi Industrial City, with WS Atkins as consultant"),("2016","Expands into property development"),("2022","Main contractor for Seven Tides' mixed-use JLT project")],
  services_title="What we build",
  services=[("Civil Engineering","Concept, design and site operations: site takeover, traditional and piled foundations, general construction through to hand-over."),
            ("Construction Design","Design input that keeps buildability, cost and programme in step from day one."),
            ("Mechanical Services","HVAC, chilled water, plumbing and drainage installed and commissioned by our own teams."),
            ("Electrical Services","Power, lighting and extra-low-voltage systems for commercial and industrial buildings.")],
  sectors=["High-rise buildings","Administration buildings","Educational buildings","Industrial buildings","Hotels","Villas & residential communities","Infrastructure & car parks"],
  work_title="Selected projects",
  work=[("Saadiyat Noon","Administrative"),("Yas School","Educational"),("Al Falah School","Educational"),("ENEC Emergency Center","Administrative"),
        ("ADNOC Villas","Residential"),("Al Khail Avenue Mall","Commercial"),("Crowne Plaza","Hotel"),("Le Royal Meridien","Hotel"),
        ("Ministry of Finance","Administrative"),("Movenpick Oceana Residence","Residential"),("RTA eMetro Car Parking","Infrastructure"),("Abu Dhabi Industrial City","Industrial · 2003")],
  contacts=[("Abu Dhabi branch","Saadiyat Noon Office Building, 2nd Floor, Saadiyat Island, Abu Dhabi"),
            ("Dubai branch","Shobha Ivory 2, Al Amal St, PO Box 28608, Dubai"),
            ("Phone","+971 2 627 4733"),("Fax","+971 2 627 2112"),("Email","dcon@eim.ae")],
  phone="+97126274733", email="dcon@eim.ae", map_q="Saadiyat Noon Office Building Abu Dhabi",
  issues=["'Lorem ipsum' placeholder text in the Working Process section",
          "Footer shows a broken phone '+) 22 256 7890' and an unrelated email",
          "Says 35+ years in one place and 40+ in another",
          "Project cards are empty: no photos or titles",
          "French language link goes nowhere; typos like 'Dubaii'"],
  art="construction"),
 dict(
  slug="technical-scissors", name="Technical Scissors", legal="Technical Scissors Company (TSC)",
  site="https://tsc-me.com/", segment="Military & uniforms",
  logo=None,
  theme=dict(bg="#1C1F17", ink="#EFEBDD", panel="#262A1F", accent="#C9A54A", accent2="#7E8B5A", muted="#A9A88F",
             head="'Oswald', sans-serif", body="'Inter', sans-serif",
             fonts="Oswald:wght@500;600;700&family=Inter:wght@400;500;600"),
  hero_kicker="Abu Dhabi's uniform specialist since 1973",
  hero_title="Uniforms built to regulation. Tailored to the person.",
  hero_sub="Military, police and security, hospital, hotel and workwear uniforms, with ranks, berets, badges and accessories, designed, tailored and supplied from Abu Dhabi.",
  cta="Request a quotation",
  stats=[("1973","Founded in Abu Dhabi"),("ISO","Certified procedures"),("UAE + Qatar","Operations"),("GCC","Expansion under way")],
  stat_note="",
  about_title="Five decades of dressing the people who serve",
  about=["Since its establishment in 1973 in the Emirate of Abu Dhabi, Technical Scissors Company has specialised in uniforms: stitching and supplying textiles, clothes, furnishings, shoes, and civil and military outfits.",
         "TSC serves the military, government departments, private and public companies, establishments and individuals, with ISO-certified standard operating procedures.",
         "After opening its first international operation in Qatar, TSC is extending its reach across the GCC."],
  timeline=[("1973","Founded in Abu Dhabi"),("ISO","Standard operating procedures certified"),("Qatar","First international operation"),("Today","Extending to all GCC nations")],
  services_title="Uniforms & equipment",
  services=[("Military uniforms","Field, service and ceremonial uniforms to specification, with matching ranks and insignia."),
            ("Police & security","Uniforms for police, security and guarding teams, supplied at volume."),
            ("Ceremonial (Salminom)","Dress uniforms for bands and ceremonial units, tailored and finished by hand."),
            ("Hospital & healthcare","Scrubs and clinical wear for hospitals and clinics."),
            ("Hotel & hospitality","Front-of-house, kitchen and housekeeping uniforms."),
            ("Workwear","Durable uniforms for workers, crews and captains.")],
  sectors=["Berets & caps","Badges & ranks","Medals & metal badges","Belts & buttons","Flags & lanyards","Vests & fabrics","Shoes & gloves","Bags & field accessories"],
  work_title="Who we dress",
  work=[("Armed forces","Military"),("Police & security","Government"),("Ministries & departments","Government"),("Hospitals","Healthcare"),
        ("Hotels","Hospitality"),("Companies & crews","Private sector")],
  contacts=[("Corporate office","Khalidiya Street, Zayed Road, PO Box 2311, Abu Dhabi"),
            ("Phone","+971 2 666 2115"),("Mobile","+971 58 540 4222"),("Fax","+971 2 666 8436"),("Email","info@tsc-me.com"),
            ("Showrooms","Khalidiya · Muroor · Mazyad Mall · Zayed showroom · Mina School branch")],
  phone="+97126662115", wa="971585404222", email="info@tsc-me.com", map_q="Technical Scissors Abu Dhabi",
  issues=["Copyright still says 2017",
          "Placeholder titles 'News Heading 1/2/3' are live",
          "Says 6 branches on one page and 15 on another",
          "Three different head-office addresses across pages",
          "Products shown only as codes (CAU 966…), partners section empty"],
  art="uniform"),
 dict(
  slug="al-saqer-property-management", name="Al Saqer Property Management", legal="Al Saqer Property Management (ASPM)",
  site="https://www.aspm.ae/", segment="Real estate",
  logo=None,
  theme=dict(bg="#F6F1E8", ink="#14213D", panel="#FFFFFF", accent="#B08A4E", accent2="#14213D", muted="#5E6678",
             head="'Fraunces', serif", body="'Inter', sans-serif",
             fonts="Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500;600"),
  hero_kicker="Part of United Al Saqer Group · since 2003",
  hero_title="Homes that are run properly. Assets that perform.",
  hero_sub="Leasing, property and facility management, owners' associations and sales across Abu Dhabi, Al Ain, Dubai and the Northern Emirates, with 24/7 support for every resident.",
  cta="Talk to a property manager",
  stats=[("4,200+","Apartments managed"),("70+","Buildings"),("97%","Minimum occupancy"),("24/7","Customer service")],
  stat_note="Figures as stated on the current website.",
  about_title="Twenty years of keeping buildings full and residents happy",
  about=["Al Saqer Property Management was founded in 2003 as a property development and leasing company and is part of United Al Saqer Group LLC, alongside Abu Dhabi Motors and Al Saqer Heavy Equipment.",
         "ASPM manages, owns and leases residential, commercial and retail real estate in Abu Dhabi, Al Ain, Dubai and internationally, and is an accredited Owners Association management provider.",
         "In 2025 ASPM received the Leadership in Real Estate Portfolio Management honour at the Pillars of Real Estate Awards."],
  timeline=[("2003","Founded as part of United Al Saqer Group"),("OA","Accredited Owners Association manager"),("CCAD","Management agreement for Cleveland Clinic Abu Dhabi employee housing"),("2025","Pillars of Real Estate Award: Leadership in Portfolio Management"),("Now","ASPM Living app for residents")],
  services_title="Services",
  services=[("Property management","Leasing, rent collection, renewals and reporting that protect long-term value."),
            ("Facility management","Soft and hard FM: landscaping, cleaning, fire safety, plumbing and electrical."),
            ("Owners associations","Governance, shared facilities and transparent finances for owner communities."),
            ("Strategic sales","Market-driven pricing and a seamless process from listing to closing."),
            ("Marketing","Positioning and campaigns that fill units and reposition assets."),
            ("Health club & community","Gyms, pools and community events that keep residents renewing.")],
  sectors=["Residential","Commercial","Retail","Staff housing","Mixed-use","Owner communities"],
  work_title="Portfolio highlights",
  work=[("Al Bustan Complex","Abu Dhabi · full FM"),("Cleveland Clinic employee housing","Abu Dhabi · management"),("Awqaf Properties","Abu Dhabi"),("Landmark Tower","Abu Dhabi")],
  contacts=[("Head office","Al Bustan Office Tower, Ground Floor, Rabdan Street, Al Saada, Zone 1, Abu Dhabi"),
            ("Phone & WhatsApp","600 555 556"),("Working hours","Mon–Thu 8:00–17:00 · Fri 8:00–12:00"),("Google rating","4.5 from 490 reviews")],
  phone="600555556", email=None, map_q="Al Bustan Office Tower Rabdan Street Abu Dhabi",
  issues=["Contact page shows a placeholder '+971 4 XXX XXXX' and a Dubai address",
          "A broken code tag '[es_property_field name=\"price\"]' shows on the home page",
          "Stat counters display '0'",
          "'Featured Properties' section is empty",
          "Headline typo: 'True Value Is Always Choose'"],
  art="realestate"),
]

ART = {
 "construction": """<svg viewBox="0 0 600 420" class="art" aria-hidden="true"><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
<rect x="0" y="0" width="600" height="420" fill="url(#g1)"/>
<g fill="none" stroke="var(--ink)" stroke-opacity=".75" stroke-width="2">
<path d="M70 400V170h90v230M95 190h40M95 220h40M95 250h40M95 280h40M95 310h40M95 340h40"/>
<path d="M190 400V90h120v310M210 115h80M210 150h80M210 185h80M210 220h80M210 255h80M210 290h80M210 325h80M210 360h80"/>
<path d="M340 400V200h110v200M360 225h70M360 260h70M360 295h70M360 330h70M360 365h70"/>
<path d="M480 400V60M480 70h110M480 70l-60 30M560 70v40M545 110h30v30h-30z"/>
</g><g stroke="var(--accent)" stroke-width="3" fill="none"><path d="M480 60l100 0M480 60l50-30 50 30"/><path d="M560 140v120"/></g>
<rect x="0" y="398" width="600" height="22" fill="var(--accent)" opacity=".9"/></svg>""",
 "uniform": """<svg viewBox="0 0 600 420" class="art" aria-hidden="true"><defs><pattern id="tw" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="14" fill="var(--panel)"/><rect width="7" height="14" fill="var(--accent2)" opacity=".22"/></pattern></defs>
<rect width="600" height="420" fill="url(#tw)"/>
<g transform="translate(160 40)"><path d="M70 40l70-30 70 30 70 40-30 70-40-20v250H70V130l-40 20L0 80z" fill="var(--accent2)" stroke="var(--ink)" stroke-opacity=".5" stroke-width="2"/>
<path d="M140 10v330" stroke="var(--ink)" stroke-opacity=".35" stroke-width="2"/>
<g fill="var(--accent)"><circle cx="140" cy="120" r="6"/><circle cx="140" cy="170" r="6"/><circle cx="140" cy="220" r="6"/><circle cx="140" cy="270" r="6"/></g>
<rect x="85" y="95" width="40" height="10" fill="var(--accent)"/><rect x="85" y="110" width="40" height="10" fill="var(--accent)" opacity=".7"/>
<path d="M190 100h40l-6 30h-28z" fill="none" stroke="var(--accent)" stroke-width="3"/></g></svg>""",
 "realestate": """<svg viewBox="0 0 600 420" class="art" aria-hidden="true"><rect width="600" height="420" fill="var(--accent2)"/>
<circle cx="470" cy="110" r="60" fill="var(--accent)" opacity=".85"/>
<g fill="#ffffff" opacity=".1"><rect x="40" y="150" width="80" height="270"/><rect x="140" y="90" width="100" height="330"/><rect x="260" y="190" width="90" height="230"/><rect x="370" y="130" width="70" height="290"/><rect x="460" y="230" width="110" height="190"/></g>
<g fill="var(--accent)" opacity=".55">""" + "".join(f'<rect x="{x}" y="{y}" width="12" height="16"/>' for x in (160,190,215) for y in range(110,400,34)) + "".join(f'<rect x="{x}" y="{y}" width="10" height="14"/>' for x in (385,410) for y in range(150,400,30)) + """</g>
<path d="M0 420h600" stroke="var(--accent)" stroke-width="6"/></svg>""",
}

CSS = """
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit}img{max-width:100%;display:block}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
.ribbon{background:var(--accent);color:#111;font-size:13px;text-align:center;padding:7px 12px;font-weight:600}
.ribbon a{font-weight:700}
header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}
.nav{display:flex;align-items:center;justify-content:space-between;height:72px;gap:16px}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;font-family:var(--head);font-weight:700;font-size:20px;letter-spacing:.01em}
.brand img{height:40px;width:auto;background:#fff;border-radius:6px;padding:4px}
.mark{width:38px;height:38px;border-radius:8px;background:var(--accent);color:#111;display:grid;place-items:center;font-weight:800;font-size:15px}
nav.links{display:flex;gap:6px}
nav.links a{text-decoration:none;padding:9px 14px;border-radius:999px;font-weight:500;font-size:15px;opacity:.8}
nav.links a.on,nav.links a:hover{opacity:1;background:color-mix(in srgb,var(--ink) 8%,transparent)}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#111;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:999px;border:0;cursor:pointer;font-size:15px}
.btn.ghost{background:transparent;color:var(--ink);border:1.5px solid color-mix(in srgb,var(--ink) 40%,transparent)}
.menu{display:none;background:none;border:0;color:var(--ink);font-size:26px;cursor:pointer}
section.page{display:none}section.page.on{display:block;animation:fade .35s ease}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.hero{padding:72px 0 56px}
.hero .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}
.kicker{font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
h1,h2,h3{font-family:var(--head);line-height:1.1;letter-spacing:-.01em}
h1{font-size:clamp(36px,5vw,60px);margin:14px 0 18px}
h2{font-size:clamp(28px,3.4vw,40px);margin-bottom:14px}
h3{font-size:20px;margin-bottom:8px}
.lead{font-size:18px;color:var(--muted);max-width:56ch}
.ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}
.art{width:100%;height:auto;border-radius:20px;border:1px solid color-mix(in srgb,var(--ink) 12%,transparent)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:color-mix(in srgb,var(--ink) 12%,transparent);border-radius:18px;overflow:hidden;margin-top:56px}
.stat{background:var(--panel);padding:22px}
.stat b{display:block;font-family:var(--head);font-size:30px;color:var(--accent)}
.stat span{font-size:14px;color:var(--muted)}
.note{font-size:12px;color:var(--muted);margin-top:8px}
.band{padding:72px 0}
.band.alt{background:var(--panel)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;margin-top:28px}
.card{background:var(--panel);border:1px solid color-mix(in srgb,var(--ink) 10%,transparent);border-radius:18px;padding:24px}
.band.alt .card{background:var(--bg)}
.card .n{font-family:var(--head);color:var(--accent);font-size:14px;letter-spacing:.1em}
.card p{color:var(--muted);font-size:15px}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.chip{border:1px solid color-mix(in srgb,var(--ink) 20%,transparent);border-radius:999px;padding:8px 14px;font-size:14px}
.work{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:28px}
.tile{position:relative;border-radius:16px;padding:22px;min-height:130px;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;
 background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 28%,var(--panel)),var(--panel) 70%);border:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}
.tile small{color:var(--muted);font-size:13px}
.tile b{font-family:var(--head);font-size:19px}
/* before / after */
.ba-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:36px;align-items:center;margin-top:28px}
.ba{position:relative;aspect-ratio:16/10;border-radius:18px;overflow:hidden;user-select:none;touch-action:none;cursor:ew-resize;
 border:1px solid color-mix(in srgb,var(--ink) 15%,transparent);box-shadow:0 30px 60px -30px rgba(0,0,0,.5);--pos:50%}
.ba .layer{position:absolute;inset:0}
.ba .before{clip-path:inset(0 calc(100% - var(--pos)) 0 0);background:#e9e9e9;z-index:2}
.ba .before img{width:100%;height:100%;object-fit:cover;object-position:top;filter:saturate(.85)}
.ba .fallback{display:none;position:absolute;inset:0;padding:64px 28px 28px;background:repeating-linear-gradient(45deg,#ddd,#ddd 10px,#e8e8e8 10px,#e8e8e8 20px);color:#333;font:14px/1.5 Georgia,serif}
.ba .fallback b{display:block;font-size:18px;margin-bottom:8px}
.ba .after{background:var(--bg);overflow:hidden}
.ba .handle{position:absolute;top:0;bottom:0;left:var(--pos);width:3px;background:#fff;z-index:3;transform:translateX(-50%);box-shadow:0 0 0 1px rgba(0,0,0,.2)}
.ba .knob{position:absolute;top:50%;left:50%;width:46px;height:46px;border-radius:50%;background:#fff;color:#111;transform:translate(-50%,-50%);display:grid;place-items:center;font-weight:800;box-shadow:0 6px 20px rgba(0,0,0,.35)}
.ba .tag{position:absolute;top:14px;z-index:4;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:6px 10px;border-radius:999px}
.ba .tag.l{left:14px;background:#111;color:#fff}.ba .tag.r{right:14px;background:var(--accent);color:#111}
.ba input{position:absolute;inset:auto 0 0 0;width:100%;opacity:0;height:30px;z-index:5}
.mini{transform:scale(.62);transform-origin:top left;width:161%;height:161%;padding:34px 40px}
.mini .bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:40px;font-family:var(--head);font-weight:700}
.mini .bar i{font-style:normal;font-family:var(--body);font-weight:500;opacity:.7;margin-left:18px;font-size:15px}
.mini h1{font-size:46px;max-width:16ch}
.mini .row{display:grid;grid-template-columns:1.1fr .9fr;gap:30px;align-items:center}
.fixes{list-style:none}.fixes li{padding:12px 0 12px 34px;position:relative;border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent);font-size:15px}
.fixes li:before{content:"✕";position:absolute;left:0;top:11px;width:22px;height:22px;border-radius:50%;background:#c0392b;color:#fff;font-size:12px;display:grid;place-items:center}
.fixes li.ok:before{content:"✓";background:#2e8b57}
/* about */
.split{display:grid;grid-template-columns:1fr 1fr;gap:56px}
.prose p{margin-bottom:16px;color:var(--muted);font-size:17px}
.tl{list-style:none;border-left:2px solid var(--accent);padding-left:24px}
.tl li{margin-bottom:22px;position:relative}
.tl li:before{content:"";position:absolute;left:-31px;top:6px;width:12px;height:12px;border-radius:50%;background:var(--accent)}
.tl b{font-family:var(--head);font-size:18px;display:block}
.tl span{color:var(--muted)}
/* contact */
.cgrid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:28px}
.cl{list-style:none}.cl li{padding:16px 0;border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}
.cl small{display:block;color:var(--accent);font-weight:600;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
form .f{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
form label{font-size:14px;font-weight:600}
form input,form textarea,form select{background:var(--bg);color:var(--ink);border:1px solid color-mix(in srgb,var(--ink) 22%,transparent);border-radius:12px;padding:13px 14px;font:inherit}
form textarea{min-height:110px}
.ctaband{padding:64px 0;background:var(--accent);color:#111}
.ctaband .wrap{display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap}
.ctaband h2{margin:0}.ctaband .btn{background:#111;color:#fff}
footer{padding:40px 0;font-size:14px;color:var(--muted);border-top:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}
footer .wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.wa{position:fixed;right:20px;bottom:20px;z-index:30;width:56px;height:56px;border-radius:50%;background:#25D366;display:grid;place-items:center;box-shadow:0 10px 30px rgba(0,0,0,.3)}
@media (max-width:900px){
 .hero .grid,.split,.cgrid,.ba-grid{grid-template-columns:1fr}
 .stats{grid-template-columns:repeat(2,1fr)}
 nav.links{display:none;position:absolute;top:72px;left:0;right:0;flex-direction:column;background:var(--bg);padding:12px 24px;border-bottom:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}
 nav.links.open{display:flex}.menu{display:block}.nav .btn{display:none}
}
"""

JS = """
const pages=[...document.querySelectorAll('section.page')],links=[...document.querySelectorAll('nav.links a')];
function show(){const id=(location.hash||'#home').slice(1);const p=pages.find(x=>x.id===id)||pages[0];
 pages.forEach(x=>x.classList.toggle('on',x===p));links.forEach(a=>a.classList.toggle('on',a.getAttribute('href')==='#'+p.id));
 document.querySelector('nav.links').classList.remove('open');window.scrollTo(0,0);}
addEventListener('hashchange',show);show();
document.querySelector('.menu').onclick=()=>document.querySelector('nav.links').classList.toggle('open');
document.querySelectorAll('.ba').forEach(ba=>{const r=ba.querySelector('input');
 const set=v=>{v=Math.max(0,Math.min(100,v));ba.style.setProperty('--pos',v+'%');r.value=v;};
 const at=ev=>{const b=ba.getBoundingClientRect();set((ev.clientX-b.left)/b.width*100);};
 let drag=false;ba.addEventListener('pointerdown',ev=>{drag=true;ba.setPointerCapture(ev.pointerId);at(ev);});
 ba.addEventListener('pointermove',ev=>{if(drag||ev.pointerType==='mouse')at(ev);});
 ba.addEventListener('pointerup',()=>drag=false);r.addEventListener('input',()=>set(+r.value));});
document.querySelectorAll('form').forEach(f=>f.onsubmit=ev=>{ev.preventDefault();
 if(!f.dataset.mail){f.querySelector('button').textContent='Thanks, we will call you back ✓';return;}
 const d=new FormData(f);const body=[...d.entries()].map(([k,v])=>k+': '+v).join('\\n');
 location.href='mailto:'+f.dataset.mail+'?subject='+encodeURIComponent('Website enquiry')+'&body='+encodeURIComponent(body);});
"""

def page(c):
    t = c["theme"]
    shot = f"https://image.thum.io/get/width/1280/crop/800/noanimate/{c['site']}"
    brand = (f'<img src="{e(c["logo"])}" alt="{e(c["name"])} logo" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{{className:\'mark\',textContent:\'{e(c["name"][:2].upper())}\'}}))">'
             if c["logo"] else f'<span class="mark">{e("".join(w[0] for w in c["name"].split()[:2]).upper())}</span>')
    stats = "".join(f'<div class="stat"><b>{e(a)}</b><span>{e(b)}</span></div>' for a, b in c["stats"])
    services = "".join(f'<div class="card"><div class="n">{i:02d}</div><h3>{e(a)}</h3><p>{e(b)}</p></div>' for i, (a, b) in enumerate(c["services"], 1))
    chips = "".join(f'<span class="chip">{e(s)}</span>' for s in c["sectors"])
    work = "".join(f'<div class="tile"><small>{e(b)}</small><b>{e(a)}</b></div>' for a, b in c["work"])
    about = "".join(f"<p>{e(p)}</p>" for p in c["about"])
    tl = "".join(f"<li><b>{e(a)}</b><span>{e(b)}</span></li>" for a, b in c["timeline"])
    cl = "".join(f"<li><small>{e(a)}</small>{e(b)}</li>" for a, b in c["contacts"])
    issues = "".join(f"<li>{e(i)}</li>" for i in c["issues"])
    fixed = ["Clear headline and one call to action", "Real contact details on every page", "Mobile-first, fast, 4 focused pages", "WhatsApp and enquiry form on every page"]
    fixed_html = "".join(f'<li class="ok">{e(x)}</li>' for x in fixed)
    mail = c["email"] or ""
    form_attr = f'data-mail="{e(mail)}"' if mail else ""
    form_note = "" if mail else '<p class="note">On the live site this form will go to your team\'s inbox or CRM.</p>'
    mini = f"""<div class="mini"><div class="bar"><span>{e(c['name'])}</span><span><i>Home</i><i>About</i><i>Services</i><i>Contact</i></span></div>
<div class="row"><div><div class="kicker">{e(c['hero_kicker'])}</div><h1>{e(c['hero_title'])}</h1><span class="btn">{e(c['cta'])} →</span></div><div>{ART[c['art']]}</div></div></div>"""
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(c['name'])} · website revamp concept</title><meta name="robots" content="noindex,nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family={t['fonts']}&display=swap">
<style>:root{{--bg:{t['bg']};--ink:{t['ink']};--panel:{t['panel']};--accent:{t['accent']};--accent2:{t['accent2']};--muted:{t['muted']};--head:{t['head']};--body:{t['body']}}}{CSS}</style></head>
<body>
<div class="ribbon">Website revamp concept prepared by Claimly AI for {e(c['legal'])}. Not the official website · current site: <a href="{e(c['site'])}" target="_blank" rel="noopener">{e(c['site'].split('//')[1].strip('/'))}</a></div>
<header><div class="wrap nav"><a class="brand" href="#home">{brand}<span>{e(c['name'])}</span></a>
<nav class="links"><a href="#home">Home</a><a href="#about">About</a><a href="#services">Services</a><a href="#contact">Contact</a></nav>
<a class="btn" href="#contact">{e(c['cta'])}</a><button class="menu" aria-label="Menu">☰</button></div></header>

<section class="page" id="home">
 <div class="hero"><div class="wrap"><div class="grid"><div><div class="kicker">{e(c['hero_kicker'])}</div><h1>{e(c['hero_title'])}</h1><p class="lead">{e(c['hero_sub'])}</p>
 <div class="ctas"><a class="btn" href="#contact">{e(c['cta'])} →</a><a class="btn ghost" href="#services">{e(c['services_title'])}</a></div></div>
 <div>{ART[c['art']]}</div></div>
 <div class="stats">{stats}</div>{f'<p class="note">{e(c["stat_note"])}</p>' if c['stat_note'] else ''}</div></div>

 <div class="band alt"><div class="wrap"><div class="kicker">Before &amp; after</div><h2>Drag to compare the current site with the revamp</h2>
 <div class="ba-grid"><div class="ba" style="--pos:50%">
  <div class="layer after">{mini}</div>
  <div class="layer before"><img src="{e(shot)}" alt="Current {e(c['name'])} website" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
   <div class="fallback"><b>Current website</b>{e(c['site'])}<br><br>{'<br>'.join('• '+e(i) for i in c['issues'])}</div></div>
  <div class="handle"><div class="knob">⇆</div></div><span class="tag l">Before</span><span class="tag r">After</span>
  <input type="range" min="0" max="100" value="50" aria-label="Before and after slider"></div>
  <div><h3>What we found on the current site</h3><ul class="fixes">{issues}</ul><h3 style="margin-top:22px">What the revamp fixes</h3><ul class="fixes">{fixed_html}</ul></div></div>
 </div></div>

 <div class="band"><div class="wrap"><div class="kicker">{e(c['services_title'])}</div><h2>{e(c['about_title'])}</h2><div class="cards">{services}</div></div></div>
 <div class="band alt"><div class="wrap"><div class="kicker">Track record</div><h2>{e(c['work_title'])}</h2><div class="work">{work}</div></div></div>
 <div class="ctaband"><div class="wrap"><h2>{e(c['cta'])}</h2><a class="btn" href="#contact">Get in touch →</a></div></div>
</section>

<section class="page" id="about"><div class="band"><div class="wrap"><div class="kicker">About</div><h2>{e(c['about_title'])}</h2>
 <div class="split"><div class="prose">{about}</div><ul class="tl">{tl}</ul></div>
 <div class="stats">{stats}</div></div></div></section>

<section class="page" id="services"><div class="band"><div class="wrap"><div class="kicker">{e(c['services_title'])}</div><h2>{e(c['services_title'])}</h2>
 <div class="cards">{services}</div><h3 style="margin-top:44px">Also</h3><div class="chips">{chips}</div></div></div>
 <div class="band alt"><div class="wrap"><h2>{e(c['work_title'])}</h2><div class="work">{work}</div></div></div></section>

<section class="page" id="contact"><div class="band"><div class="wrap"><div class="kicker">Contact</div><h2>{e(c['cta'])}</h2>
 <div class="cgrid"><ul class="cl">{cl}<li><small>Map</small><a href="https://www.google.com/maps/search/{e(c['map_q'].replace(' ','+'))}" target="_blank" rel="noopener">Open in Google Maps ↗</a></li></ul>
 <form class="card" {form_attr}><div class="f"><label for="n">Name</label><input id="n" name="Name" required></div>
 <div class="f"><label for="co">Company</label><input id="co" name="Company"></div>
 <div class="f"><label for="ph">Phone / WhatsApp</label><input id="ph" name="Phone"></div>
 <div class="f"><label for="m">How can we help?</label><textarea id="m" name="Message"></textarea></div>
 <button class="btn" type="submit">Send enquiry →</button>{form_note}</form></div></div></div></section>

<footer><div class="wrap"><span>© {e(c['legal'])}</span><span>Concept by Claimly AI · claimly.ae</span></div></footer>
<a class="wa" href="{('https://wa.me/'+c['wa']) if c.get('wa') else ('tel:'+c['phone'])}" aria-label="WhatsApp" target="_blank" rel="noopener"><svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2s-1 .3-3.4-.7a11.4 11.4 0 0 1-4.6-4.1c-.5-.7-1-1.8-1-2.9s.6-1.7.8-1.9.5-.3.6-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.2-.3.3-.1.6a8.4 8.4 0 0 0 3.9 3.4c.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.8.9c.3.1.5.2.5.3a2 2 0 0 1-.2 1z"/></svg></a>
<script>{JS}</script></body></html>"""

for c in COMPANIES:
    p = os.path.join(OUT, f"{c['slug']}-revamp.html")
    open(p, "w").write(page(c))
    print(p, os.path.getsize(p))

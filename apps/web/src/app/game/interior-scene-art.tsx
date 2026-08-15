type Props = Readonly<{
  theme: "market" | "office";
}>;

function WindowView() {
  return (
    <g aria-hidden="true">
      <rect x="350" y="38" width="500" height="150" rx="10" fill="#142234" stroke="#8aa3b5" strokeWidth="5" />
      <rect x="365" y="52" width="470" height="122" rx="4" fill="#83a8b2" />
      <path d="M365 148 L445 96 L500 135 L570 75 L648 132 L710 88 L835 152 V174 H365 Z" fill="#345f5b" />
      <path d="M365 154 L460 115 L525 145 L610 104 L700 145 L770 120 L835 154 V174 H365 Z" fill="#26454b" />
      <path d="M521 52 V174 M678 52 V174" stroke="#172334" strokeWidth="8" />
      <circle cx="770" cy="82" r="20" fill="#e6cf83" opacity=".88" />
    </g>
  );
}

function MarketScene() {
  return (
    <>
      <rect width="1200" height="620" fill="#342a2a" />
      <rect width="1200" height="235" fill="#49372f" />
      <WindowView />
      <path d="M0 228 H1200 V620 H0 Z" fill="#6e5545" />
      <path d="M0 620 L600 235 L1200 620 Z" fill="#8d7059" opacity=".62" />
      {Array.from({ length: 10 }, (_, index) => (
        <path key={index} d={`M${index * 135 - 75} 620 L600 235`} stroke="#4c3b34" strokeWidth="3" opacity=".48" />
      ))}
      <path d="M0 445 H1200 M0 535 H1200" stroke="#4b3932" strokeWidth="4" opacity=".5" />

      <g transform="translate(78 165)">
        <rect x="0" y="0" width="220" height="205" rx="14" fill="#3c2a25" stroke="#1f1818" strokeWidth="6" />
        <path d="M-12 0 H232 L205 -48 H17 Z" fill="#a85d3f" stroke="#40221d" strokeWidth="6" />
        <path d="M18 -46 V-4 M62 -46 V-4 M106 -46 V-4 M150 -46 V-4 M194 -46 V-4" stroke="#e6c27a" strokeWidth="16" />
        <rect x="22" y="40" width="176" height="58" rx="8" fill="#1e2325" />
        <circle cx="57" cy="69" r="17" fill="#d8a955" /><circle cx="108" cy="69" r="17" fill="#8aa15e" /><circle cx="159" cy="69" r="17" fill="#bc6b53" />
        <rect x="30" y="126" width="160" height="52" rx="8" fill="#5e412e" />
        <path d="M45 151 H175" stroke="#d8b16f" strokeWidth="5" strokeLinecap="round" />
      </g>

      <g transform="translate(895 165)">
        <rect x="0" y="0" width="225" height="205" rx="14" fill="#2f3430" stroke="#171d1a" strokeWidth="6" />
        <path d="M-12 0 H237 L208 -48 H18 Z" fill="#4c7765" stroke="#20352d" strokeWidth="6" />
        <path d="M20 -46 V-4 M64 -46 V-4 M108 -46 V-4 M152 -46 V-4 M196 -46 V-4" stroke="#d7c985" strokeWidth="16" />
        <rect x="22" y="40" width="181" height="58" rx="8" fill="#202925" />
        <path d="M38 77 Q56 47 75 77 T112 77 T150 77 T188 77" fill="none" stroke="#91b86c" strokeWidth="16" strokeLinecap="round" />
        <rect x="33" y="126" width="158" height="52" rx="8" fill="#4c5a42" />
        <path d="M49 151 H175" stroke="#d8cc82" strokeWidth="5" strokeLinecap="round" />
      </g>

      <g transform="translate(365 285)">
        <path d="M0 44 L48 0 H422 L470 44 L438 160 H32 Z" fill="#6b4732" stroke="#2b201c" strokeWidth="8" />
        <path d="M48 0 H422 L385 36 H84 Z" fill="#a7774d" />
        <rect x="72" y="68" width="326" height="54" rx="8" fill="#3d2b27" />
        <path d="M110 96 H360" stroke="#e0bc74" strokeWidth="6" strokeLinecap="round" />
        <text x="235" y="101" fill="#f0d49b" fontSize="24" fontWeight="800" textAnchor="middle">MERCADO MUNICIPAL</text>
      </g>

      <g fill="#29352d" stroke="#172019" strokeWidth="4">
        <rect x="45" y="460" width="70" height="110" rx="10" /><rect x="1085" y="460" width="70" height="110" rx="10" />
      </g>
      <g fill="#5d8d5a">
        <circle cx="80" cy="442" r="38" /><circle cx="1120" cy="442" r="38" />
        <circle cx="55" cy="463" r="26" /><circle cx="1145" cy="463" r="26" />
      </g>
      <g fill="#d2af72">
        <circle cx="170" cy="420" r="5" /><circle cx="1030" cy="420" r="5" /><circle cx="315" cy="278" r="5" /><circle cx="885" cy="278" r="5" />
      </g>
    </>
  );
}

function OfficeScene() {
  return (
    <>
      <rect width="1200" height="620" fill="#263746" />
      <rect width="1200" height="235" fill="#334d5b" />
      <WindowView />
      <path d="M0 225 H1200 V620 H0 Z" fill="#526671" />
      <path d="M0 620 L600 238 L1200 620 Z" fill="#71838a" opacity=".52" />
      {Array.from({ length: 9 }, (_, index) => (
        <path key={index} d={`M${index * 155 - 40} 620 L600 238`} stroke="#384d58" strokeWidth="3" opacity=".48" />
      ))}
      <path d="M0 440 H1200 M0 535 H1200" stroke="#3a4e58" strokeWidth="4" opacity=".55" />

      <g transform="translate(105 132)">
        <rect width="180" height="245" rx="14" fill="#243540" stroke="#16232b" strokeWidth="6" />
        <rect x="19" y="22" width="142" height="45" rx="6" fill="#6e8d99" />
        <text x="90" y="51" fill="#e9f1f2" fontSize="19" fontWeight="800" textAnchor="middle">SERVIÇOS</text>
        <path d="M24 102 H156 M24 142 H156 M24 182 H156" stroke="#526d78" strokeWidth="10" strokeLinecap="round" />
        <circle cx="42" cy="102" r="9" fill="#8cc59d" /><circle cx="42" cy="142" r="9" fill="#d2b56e" /><circle cx="42" cy="182" r="9" fill="#7da8c6" />
      </g>

      <g transform="translate(915 132)">
        <rect width="180" height="245" rx="14" fill="#243540" stroke="#16232b" strokeWidth="6" />
        <rect x="19" y="22" width="142" height="45" rx="6" fill="#536f7d" />
        <text x="90" y="51" fill="#e9f1f2" fontSize="19" fontWeight="800" textAnchor="middle">OPORTUNIDADES</text>
        <rect x="28" y="92" width="124" height="33" rx="6" fill="#314a56" /><rect x="28" y="140" width="124" height="33" rx="6" fill="#314a56" /><rect x="28" y="188" width="124" height="33" rx="6" fill="#314a56" />
        <path d="M45 108 H132 M45 156 H118 M45 204 H138" stroke="#9cc2c6" strokeWidth="5" strokeLinecap="round" />
      </g>

      <g transform="translate(350 285)">
        <path d="M0 55 L54 0 H446 L500 55 L463 163 H37 Z" fill="#385665" stroke="#1d2d35" strokeWidth="8" />
        <path d="M54 0 H446 L407 38 H93 Z" fill="#64828e" />
        <rect x="78" y="70" width="344" height="58" rx="8" fill="#263d48" />
        <path d="M112 100 H388" stroke="#a8c7c7" strokeWidth="6" strokeLinecap="round" />
        <text x="250" y="106" fill="#e8f0ed" fontSize="23" fontWeight="800" textAnchor="middle">ATENDIMENTO CIDADÃO</text>
      </g>

      <g transform="translate(294 162)">
        <rect width="76" height="116" rx="8" fill="#243740" />
        <rect x="9" y="10" width="58" height="74" rx="5" fill="#17262f" />
        <path d="M21 31 H55 M21 47 H49 M21 63 H53" stroke="#79a9a9" strokeWidth="4" strokeLinecap="round" />
        <circle cx="38" cy="99" r="6" fill="#8cc59d" />
      </g>

      <g fill="#283d37" stroke="#17251f" strokeWidth="4">
        <rect x="43" y="462" width="73" height="112" rx="10" /><rect x="1084" y="462" width="73" height="112" rx="10" />
      </g>
      <g fill="#67946f">
        <circle cx="80" cy="443" r="40" /><circle cx="1120" cy="443" r="40" />
        <circle cx="55" cy="464" r="27" /><circle cx="1145" cy="464" r="27" />
      </g>
      <g fill="#c7d3b0">
        <rect x="510" y="70" width="180" height="10" rx="5" /><rect x="520" y="95" width="160" height="5" rx="2" opacity=".45" />
      </g>
    </>
  );
}

export function InteriorSceneArt({ theme }: Props) {
  return (
    <svg aria-hidden="true" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 620">
      {theme === "market" ? <MarketScene /> : <OfficeScene />}
    </svg>
  );
}

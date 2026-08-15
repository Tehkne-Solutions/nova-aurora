import styles from "./city-scene-art.module.css";
import type { TimePhase } from "./world-presentation";

type Props = Readonly<{ timePhase: TimePhase }>;

function Tree({ x, y, scale = 1 }: Readonly<{ x: number; y: number; scale?: number }>) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse className={styles.shadow} cx="1" cy="13" rx="13" ry="5" />
      <rect className={styles.treeTrunk} x="-2" y="0" width="5" height="14" rx="2" />
      <circle className={styles.treeCrown} cx="0" cy="-4" r="12" />
      <circle className={styles.treeCrownLight} cx="-5" cy="-9" r="6" />
    </g>
  );
}

function Building({ x, y, w, h, floors = 2, accent = false }: Readonly<{ x: number; y: number; w: number; h: number; floors?: number; accent?: boolean }>) {
  const depth = 12;
  return (
    <g transform={`translate(${x} ${y})`}>
      <polygon className={styles.shadow} points={`5,${h + 8} ${w + 22},${h + 8} ${w + 8},${h + 20} -8,${h + 20}`} />
      <polygon className={styles.blockSide} points={`${w},10 ${w + depth},3 ${w + depth},${h - 7} ${w},${h}`} />
      <rect className={styles.blockSide} x="0" y="10" width={w} height={h - 10} rx="2" />
      <polygon className={styles.blockTop} points={`0,10 ${depth},3 ${w + depth},3 ${w},10`} />
      {accent ? <rect className={styles.roofAccent} x={w * .22} y="1" width={w * .44} height="5" rx="2" /> : null}
      {Array.from({ length: floors }, (_, floor) => (
        <g key={floor} transform={`translate(0 ${18 + floor * 13})`}>
          <rect className={styles.window} x="8" y="0" width="9" height="6" rx="1" />
          {w > 42 ? <rect className={styles.window} x="23" y="0" width="9" height="6" rx="1" /> : null}
          {w > 58 ? <rect className={styles.window} x="38" y="0" width="9" height="6" rx="1" /> : null}
        </g>
      ))}
    </g>
  );
}

function Lamp({ x, y }: Readonly<{ x: number; y: number }>) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className={styles.treeTrunk} x="-1" y="0" width="2" height="15" />
      <circle className={styles.lamp} cx="0" cy="-2" r="4" />
    </g>
  );
}

export function CitySceneArt({ timePhase }: Props) {
  return (
    <svg
      aria-hidden="true"
      className={`${styles.sceneArt} ${timePhase === "night" ? styles.timeNight : ""}`}
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1000 700"
    >
      <rect className={styles.sky} width="1000" height="700" />
      <path className={styles.farLand} d="M0 92 Q110 40 220 87 T430 69 T650 76 T820 48 T1000 76 V180 H0Z" />
      <path className={styles.water} d="M0 545 Q170 505 308 550 T585 546 T820 530 T1000 555 V700 H0Z" />
      <path className={styles.waterLine} d="M24 603 Q170 565 320 603 T610 597 T965 604" />
      <path className={styles.waterLine} d="M42 642 Q190 612 340 645 T650 638 T950 646" />

      <path className={styles.ground} d="M80 126 L515 68 L919 151 L884 532 L503 618 L104 522Z" />
      <path className={styles.greenGround} d="M80 126 L515 68 L515 286 L310 313 L104 258Z" />
      <path className={styles.civicGround} d="M104 258 L310 313 L501 334 L503 618 L104 522Z" />
      <path className={styles.industrialGround} d="M515 286 L919 151 L884 334 L702 350 L501 334Z" />
      <path className={styles.creativeGround} d="M501 334 L702 350 L884 334 L884 532 L503 618Z" />

      <path className={styles.road} d="M460 96 L548 86 L548 594 L462 611Z" />
      <path className={styles.road} d="M111 302 L897 277 L900 365 L105 389Z" />
      <path className={styles.roadMark} d="M505 104 L505 589" />
      <path className={styles.roadMark} d="M125 344 L882 320" />
      <path className={styles.path} d="M180 177 Q292 220 401 205" />
      <path className={styles.path} d="M657 184 Q739 213 828 199" />
      <path className={styles.path} d="M620 455 Q725 486 813 448" />

      <g transform="translate(500 334)">
        <ellipse className={styles.shadow} cx="5" cy="28" rx="65" ry="18" />
        <circle className={styles.hubRing} r="50" />
        <circle className={styles.hubInner} r="34" />
        <path className={styles.hubLine} d="M-17 10 L0 -18 L17 10 M-9 3 H9 M0 -18 V18" />
      </g>

      <g>
        <Building x={166} y={141} w={55} h={57} floors={3} accent />
        <Building x={246} y={160} w={42} h={44} floors={2} />
        <Building x={338} y={123} w={62} h={66} floors={3} />
        <Tree x={130} y={181} scale={1.1} /><Tree x={302} y={125} /><Tree x={425} y={172} scale={.9} />
        <Tree x={187} y={239} /><Tree x={355} y={238} scale={1.2} />
        <text className={styles.districtLabel} x="155" y="112">VALE VERDE</text>
        <text className={styles.districtSub} x="155" y="126">produção · pesquisa · natureza</text>
      </g>

      <g>
        <Building x={157} y={326} w={72} h={70} floors={4} accent />
        <Building x={260} y={390} w={48} h={49} floors={2} />
        <Building x={342} y={442} w={66} h={62} floors={3} />
        <rect className={styles.plaza} x="210" y="460" width="92" height="44" rx="8" transform="rotate(-5 210 460)" />
        <Tree x={142} y={432} /><Tree x={315} y={350} /><Tree x={430} y={520} />
        <Lamp x={244} y={342} /><Lamp x={392} y={382} /><Lamp x={218} y={508} />
        <text className={styles.districtLabel} x="129" y="288">CENTRO CÍVICO</text>
        <text className={styles.districtSub} x="129" y="302">serviços · mercado · governo</text>
      </g>

      <g>
        <Building x={635} y={140} w={66} h={72} floors={3} />
        <Building x={743} y={117} w={82} h={86} floors={4} accent />
        <Building x={793} y={225} w={52} h={52} floors={2} />
        <g transform="translate(690 229)">
          <rect className={styles.blockSide} x="0" y="12" width="66" height="38" />
          <polygon className={styles.blockTop} points="0,12 16,3 82,3 66,12" />
          <rect className={styles.roofAccent} x="10" y="0" width="14" height="6" />
          <rect className={styles.roofAccent} x="39" y="-5" width="11" height="11" />
          <circle className={styles.smoke} cx="46" cy="-14" r="9" />
          <circle className={styles.smoke} cx="53" cy="-25" r="12" />
        </g>
        <path className={styles.rail} d="M593 261 Q704 250 860 223" />
        {Array.from({ length: 8 }, (_, index) => <line className={styles.railTie} key={index} x1={610 + index * 31} y1={253 - index * 4} x2={616 + index * 31} y2={266 - index * 4} />)}
        <text className={styles.districtLabel} x="627" y="102">CINTURÃO INDUSTRIAL</text>
        <text className={styles.districtSub} x="627" y="116">fabricação · logística · energia</text>
      </g>

      <g>
        <Building x={614} y={386} w={58} h={58} floors={3} accent />
        <Building x={709} y={416} w={72} h={54} floors={2} />
        <Building x={790} y={373} w={48} h={74} floors={4} accent />
        <rect className={styles.plaza} x="639" y="500" width="130" height="55" rx="18" />
        <circle className={styles.hubInner} cx="704" cy="527" r="17" />
        <Tree x={582} y={490} /><Tree x={820} y={493} /><Tree x={772} y={554} /><Tree x={618} y={557} />
        <Lamp x={681} y={477} /><Lamp x={756} y={483} />
        <text className={styles.districtLabel} x="611" y="365">DISTRITO CRIATIVO</text>
        <text className={styles.districtSub} x="611" y="379">arte · eventos · criadores</text>
      </g>

      <g opacity=".78">
        <Lamp x={449} y={240} /><Lamp x={557} y={235} /><Lamp x={447} y={424} /><Lamp x={558} y={420} />
      </g>
    </svg>
  );
}

// Tehkné Solutions

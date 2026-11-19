import { useId } from "react";
import terrain from "./assets/maui-hillshade.png";

const coast = "M459.6 156.2L473.0 182.1L469.9 206.1L458.8 225.2L444.0 229.1L431.5 246.2L415.3 246.4L382.7 262.1L361.1 261.7L349.1 260.5L338.0 261.2L308.0 274.2L289.2 283.7L278.5 288.2L264.0 284.6L258.5 284.0L248.5 281.4L240.7 283.6L215.3 284.6L198.5 269.7L196.7 263.5L188.8 255.4L193.9 251.2L194.2 240.4L189.5 200.8L184.7 189.9L185.0 177.7L181.2 167.7L178.7 165.8L174.6 162.0L168.3 158.5L158.7 158.8L150.2 162.5L146.9 170.8L139.3 172.1L130.4 167.3L122.0 161.4L108.9 159.2L95.9 151.4L87.4 152.2L79.5 142.2L65.2 127.8L48.4 107.2L47.7 94.0L41.7 86.8L44.0 74.6L47.8 57.6L53.3 43.4L59.5 34.0L67.1 33.3L72.2 28.1L72.5 23.4L78.0 19.8L83.5 20.4L90.1 21.0L95.2 19.7L97.2 16.9L100.8 16.5L105.8 19.4L110.7 25.2L116.7 26.2L126.2 31.1L134.2 34.1L137.1 41.7L144.1 43.7L146.0 51.7L145.8 58.9L154.2 66.0L159.6 73.7L163.9 83.2L170.8 93.7L181.3 92.9L188.1 85.5L199.6 85.6L208.6 84.2L226.1 83.3L232.9 81.9L252.2 68.7L261.6 65.5L270.8 64.4L281.1 64.6L291.0 66.0L299.0 69.2L301.5 69.5L303.6 70.0L305.3 71.3L306.8 73.6L314.5 71.3L324.1 77.1L327.1 84.1L331.1 87.4L335.9 92.2L341.9 99.3L352.8 106.2L360.7 113.5L361.5 118.7L368.6 119.3L371.6 119.3L373.7 116.1L381.6 121.9L385.0 130.0L388.9 134.8L409.5 137.6L430.0 146.9L459.6 156.2Z";

// USGS 3DEP multidirectional hillshade, registered to Natural Earth's 1:10m coastline.
// WGS84 extent in degrees: [-156.765373, 20.525, -155.934627, 21.060].
export default function MauiRelief() {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="maui-relief" viewBox="0 0 500 322" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={id + "-land"}><path d={coast}/></clipPath>
        <filter id={id + "-ink"} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues=".12 .19 .27 .46 .62"/>
            <feFuncG type="table" tableValues=".24 .40 .53 .67 .79"/>
            <feFuncB type="table" tableValues=".29 .45 .57 .65 .71"/>
          </feComponentTransfer>
        </filter>
        <pattern id={id + "-grid"} patternUnits="userSpaceOnUse" width="39" height="39">
          <path d="M0 39V0H39" fill="none" stroke="#648f9e" strokeOpacity=".25"/>
        </pattern>
      </defs>
      <rect width="500" height="322" fill={"url(#"+id+"-grid)"}/>
      <path d={coast} className="relief-shelf" fill="none" stroke="#608897" strokeWidth="13" opacity=".22"/>
      <path d={coast} fill="#4f7d83"/>
      <image href={terrain} width="500" height="322" clipPath={"url(#"+id+"-land)"} filter={"url(#"+id+"-ink)"}/>
      <path d={coast} fill="none" stroke="#b8d5cc" strokeWidth="1.6"/>
    </svg>
  );
}

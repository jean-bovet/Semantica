// scripts/db-ingest-benchmark.ts
/* 
  LanceDB ingest memory harness (no embeddings).
  - Generates deterministic unit vectors and upserts in small batches.
  - Logs memory + computes RSS slope.
*/
import fs from "node:fs";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";

type Args = {
  dir: string;      // DB dir (temp)
  dim: number;      // vector dimension
  rows: number;     // total rows
  batch: number;    // rows per insert
  csv?: string;
};

function parseArgs(): Args {
  const get = (k:string, d?:string)=> (process.argv.find(a=>a.startsWith(`--${k}=`))?.split("=")[1] ?? d) as string;
  return {
    dir: get("dir", "./.tmp-lancedb")!,
    dim: parseInt(get("dim","384")!,10),
    rows: parseInt(get("rows","20000")!,10),
    batch: parseInt(get("batch","1000")!,10),
    csv: get("csv"),
  };
}

function memMB() {
  const u = process.memoryUsage();
  return { rss: Math.round(u.rss/1024/1024), ext: Math.round(u.external/1024/1024), heap: Math.round(u.heapUsed/1024/1024) };
}

function unitVector(i: number, dim: number): number[] {
  // cheap deterministic vector: one-hot-ish with tiny tail, normalized
  const v = new Float32Array(dim);
  v[i % dim] = 1;
  return Array.from(v);
}

async function main() {
  const args = parseArgs();
  fs.mkdirSync(args.dir, { recursive: true });

  const db = await lancedb.connect(args.dir);
  const tbl = await db.openTable("chunks").catch(async () => db.createTable("chunks", []));

  const xs:number[] = [], rss:number[] = [], ext:number[] = [];

  let written = 0;
  while (written < args.rows) {
    const n = Math.min(args.batch, args.rows - written);
    const rows = new Array(n).fill(0).map((_,j)=> {
      const id = `fake-${written+j}`;
      return {
        id, path: `/fake/${id}.txt`, mtime: Date.now(),
        page: 0, offset: 0, text: `row ${id}`,
        vector: unitVector(written+j, args.dim)
      };
    });

    await tbl.merge_insert("id").when_matched_update_all().when_not_matched_insert_all().execute(rows);

    if (global.gc) global.gc();
    const m = memMB();
    const iter = Math.ceil((written + n) / args.batch);
    console.log(`iter=${iter} rows=${written+n}/${args.rows} rss=${m.rss}MB ext=${m.ext}MB heap=${m.heap}MB`);
    xs.push(iter); rss.push(m.rss); ext.push(m.ext);
    written += n;
  }

  const slope = (arr:number[])=>{
    const n=xs.length; let sx=0,sy=0,sxx=0,sxy=0;
    for(let i=0;i<n;i++){ sx+=xs[i]; sy+=arr[i]; sxx+=xs[i]*xs[i]; sxy+=xs[i]*arr[i]; }
    const denom=(n*sxx-sx*sx)||1; return (n*sxy - sx*sy)/denom;
  };

  console.log(`\n=== SUMMARY ===
rows=${args.rows} batch=${args.batch} dim=${args.dim}
rssSlopeMBperIter=${slope(rss).toFixed(3)}
extSlopeMBperIter=${slope(ext).toFixed(3)}
`);

  if (args.csv) {
    fs.writeFileSync(args.csv, ["iter,rssMB,externalMB", ...xs.map((x,i)=>`${x},${rss[i]},${ext[i]}`)].join("\n"), "utf8");
    console.log(`CSV written: ${path.resolve(args.csv)}`);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
import { v4 as uuidv4 } from "uuid";
import { writable, derived, get } from "svelte/store";

export const nodes = writable([]);
export const edges = writable([]);
export const auto = writable(true);
export const doFit = writable(0);
export const selectedFilter = writable();

export const INPUTNAMES = [
  { name: "punch.mp4", url: "/punch.mp4", ext: "mp4", outputs: ["v", "a"], inputs: [] },
  { name: "shoe.mp4", url: "/shoe.mp4", ext: "mp4", outputs: ["v", "a"], inputs: [] },
];

export const OUTPUTNAMES = [
  { name: "out.mp4", ext: "mp4", inputs: ["v", "a"], outputs: [] },
  { name: "out.gif", ext: "gif", inputs: ["v"], outputs: [] },
];

export const inputNames = writable(INPUTNAMES);
export const outputNames = writable(OUTPUTNAMES);

addNode({ ...INPUTNAMES[0] }, "input");
addNode({ ...OUTPUTNAMES[0] }, "output");

export function makeFilterArgs(f) {
  let fCommand = f.name;
  if (f.params && f.params.length > 0) {
    let params = f.params
      .map((p) => {
        if (p.value === "" || p.value === null || p.value === p.default) return null;
        return `${p.name}=${p.value}`;
      })
      .filter((p) => p !== null)
      .join(":");
    if (params) fCommand += "=" + params;
  }
  return fCommand;
}

export const previewCommand = derived([edges, nodes], ([$edges, $nodes]) => {
  let finalCommand = [];
  let filtergraph = [];
  let labelIndex = 1;
  let outs = 0;
  const edgeIds = {};
  const inputIdMap = {};

  const inputs = $nodes.filter((n) => n.nodeType === "input");
  const inputIds = inputs.map((n) => n.id);
  const inputEdges = $edges.filter((e) => inputIds.includes(e.source));
  const outputs = $nodes.filter((n) => n.nodeType === "output");

  // create edge labels for each input
  inputs.forEach((inp, i) => (inputIdMap[inp.id] = i));

  // create edge labels for each filter
  function traverseEdges(edg, type) {
    // const outEdges = $edges.filter((e) => e.source === edg.target && (e.sourceHandle.includes(type) || e.sourceHandle.includes("n")));
    const outEdges = $edges.filter((e) => e.source === edg.target);

    let label;

    const inNode = $nodes.find((n) => n.id === edg.source);
    const outNode = $nodes.find((n) => n.id === edg.target);

    if (inNode && outNode) {
      if (inNode.nodeType === "input" && outNode.nodeType === "filter") {
        label = inputIdMap[inNode.id] + ":" + edg.sourceHandle[0];
      } else if (inNode.nodeType === "filter" && outNode.nodeType === "filter") {
        label = labelIndex;
        labelIndex++;
      } else if (inNode.nodeType === "filter" && outNode.nodeType === "output") {
        // this was breaking when it was IDing by the type, as work around i made it current-outs-count based ID and it works
        label = 'out_' + outs;
        outs++
      } else if (inNode.nodeType === "input" && outNode.nodeType === "output") {
        label = "FILTERLESS_" + inputIdMap[inNode.id] + ":" + type;
      } else {
        label = "UNKNOWN";
      }

      edgeIds[edg.id] = label;
    }

    for (let e2 of outEdges) {
      traverseEdges(e2, type);
    }
  }

  for (let inp of inputEdges) {
    for (let t of ["v", "a"]) {
      if (inp.sourceHandle.includes(t)) {
        traverseEdges(inp, t);
      }
    }
  }

  for (let n of $nodes.filter((n) => n.nodeType == "filter" && n.data.enabled)) {
    let cmd = { weight: 0, in: [], out: [], cmd: "" };

    const outs = $edges.filter((e) => e.source == n.id);
    let ins = $edges.filter((e) => e.target == n.id)

    // respect the user define input order (not just when the edges were created) this fixes a lot of issues whit complex filter like concat (v a v a) -> (v a)
    if (n?.data?.isCustom) {
      ins = ins.sort((a, b) => {
         return Number(a.targetHandle.split('_')[1]) - Number(b.targetHandle.split('_')[1])
      })
   }

    if (outs.length == 0 && ins.length == 0) continue;

    for (let i of ins) {
      const eid = edgeIds[i.id];
      if (eid) {
        if (typeof eid == "string" && eid.includes(":")) cmd.weight = -1000;
        else cmd.weight = eid;
        cmd.in.push(eid);
      }
    }

    cmd.cmd = makeFilterArgs(n.data);

    for (let o of outs) {
      const eid = edgeIds[o.id];
      if (eid) {
        if (typeof eid == "string" && eid.includes("out")) cmd.weight = 1000;
        cmd.out.push(eid);
      }
    }

    filtergraph.push(cmd);
  }

  filtergraph.sort((a, b) => {
    return a.weight - b.weight;
  });

  filtergraph = filtergraph.map((c) => {
    return c.in.map((i) => `[${i}]`).join("") + c.cmd + c.out.map((i) => `[${i}]`).join("");
  });

  finalCommand.push("ffmpeg");

  for (let inp of inputs) {
    finalCommand.push("-i");
    finalCommand.push(inp.data.name);
  }

  let mediaMaps = Object.values(edgeIds)
    .map((eid) => {
      if (String(eid).includes("FILTERLESS")) {
        return eid.split("_")[1];
      }
      return null;
    })
    .filter((m) => m !== null);

  if (filtergraph.length > 0) {
    let fg = `"${filtergraph.join(";")}"`;

    // this crazy thing replaces stuff like [1];[1] with a comma!
    fg = fg.replaceAll(/(?<!])(\[\d+\]);\1(?!\[)/g, ",");

    finalCommand.push("-filter_complex", fg);

    const getMappers = fg.match(/\[out_\d+\]/g) || [] // get all the out_0 out_1 etc

    for (let m of getMappers) {
      finalCommand.push('-map', m)
   }

    for (let m of mediaMaps) {
      finalCommand.push("-map", m);
    }
  }

  for (let out of outputs) {
    finalCommand.push(out.data.name);
  }

  return finalCommand;
});

export const inputs = derived(nodes, ($nodes) => {
  return $nodes.filter((n) => n.nodeType === "input").map((n) => n.data);
});

export const outputs = derived(nodes, ($nodes) => {
  return $nodes.filter((n) => n.nodeType === "output").map((n) => n.data);
});

nodes.subscribe(($nodes) => {
  const isAuto = get(auto);
  if (!isAuto) return;

  const outputNodes = $nodes.filter((n) => n.nodeType === "output");
  const inputNodes = $nodes.filter((n) => n.nodeType === "input");
  const filterNodes = $nodes.filter((n) => n.nodeType === "filter");
  const orderedNodes = [].concat(filterNodes, outputNodes).filter((n) => n != undefined);

  const filled = [];
  let newEdges = [];

  function connectNode(n1, rest) {
    for (let i = 0; i < n1.data.outputs.length; i++) {
      const edgeType = n1.data.outputs[i];
      for (let j = 0; j < rest.length; j++) {
        let found = false;
        const n2 = rest[j];
        for (let k = 0; k < n2.data.inputs.length; k++) {
          const targetEdgeType = n2.data.inputs[k];
          if (edgeType === targetEdgeType && !filled.includes(n2.id + k)) {
            newEdges.push({
              id: uuidv4(),
              type: "default",
              source: n1.id,
              target: n2.id,
              sourceHandle: edgeType + "_" + i,
              targetHandle: edgeType + "_" + k,
            });
            filled.push(n2.id + k);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    const nextNode = rest.shift();
    if (nextNode) {
      connectNode(nextNode, rest);
    }
  }

  for (let inpNode of inputNodes) {
    connectNode(inpNode, [...orderedNodes]);
  }

  edges.set(newEdges);
});

export function addNode(_data, type) {
  const data = JSON.parse(JSON.stringify(_data));

  let ins = [];
  let outs = [];

  if (type === "input") {
    outs = ["v", "a"];
  } else if (type === "output") {
    ins = ["v", "a"];
  } else if (type === "filter") {
    if (data.params) {
      data.params = data.params.map((p) => {
        p.value = null;
        if (p.default != null) p.value = p.default;
        return p;
      });
    }
    ins = data.inputs;
    outs = data.outputs;
  }

  data.nodeType = type;
  data.inputs = ins;
  data.outputs = outs;
  data.enabled = true;

  let node = {
    id: uuidv4(),
    type: "ffmpeg",
    data: data,
    nodeType: type,
    position: { x: 0, y: 0 },
  };

  nodes.update((_nodes) => {
    _nodes.push(node);

    _nodes = autoLayout(_nodes);

    if (node.nodeType === "filter") {
      selectedFilter.set(_nodes.length - 1);
    }
    return _nodes;
  });
}

function autoLayout(_nodes) {
  const isAuto = get(auto);

  if (isAuto) {
    const w = 120;
    const h = 50;
    const margin = 50;
    let prev = null;

    for (let n of _nodes) {
      if (n.nodeType === "input") {
        n.position = { x: 0, y: prev ? prev.position.y + h + margin : 0 };
        prev = n;
      }
    }

    for (let n of _nodes) {
      if (n.nodeType === "filter") {
        let _w = prev && prev.width ? prev.width : w;
        let _x = prev ? prev.position.x + _w + margin : 0;
        let _y = -50;
        if (n.data.inputs && n.data.inputs[0] && n.data.inputs[0] === "a") {
          _y = 50;
        }
        n.position = { x: _x, y: _y };
        prev = n;
      }
    }

    for (let n of _nodes) {
      if (n.nodeType === "output") {
        let _w = prev && prev.width ? prev.width : w;
        n.position = { x: prev ? prev.position.x + _w + margin : 0, y: 0 };
      }
    }
  }
  return _nodes;
}

export function copyNode(node) {
  const oldId = node.id;
  node = JSON.parse(JSON.stringify(node));
  node.id = uuidv4();

  nodes.update((_nodes) => {
    _nodes.push(node);

    const index = _nodes.findIndex((n) => n.id === oldId);
    _nodes.splice(index, 1);

    _nodes = autoLayout(_nodes);

    if (node.nodeType === "filter") {
      selectedFilter.set(_nodes.length - 1);
    }
    return _nodes;
  });
}

export function resetNodes() {
  nodes.set([]);
  addNode({ name: "punch.mp4" }, "input");
  addNode({ name: "out.mp4" }, "output");
}

export function removeNode(id) {
  nodes.update((_nodes) => {
    const index = _nodes.findIndex((n) => n.id === id);
    _nodes.splice(index, 1);
    return _nodes;
  });
}

export function updateNode(id, data){
  nodes.update((_nodes)=>{
    const node = _nodes.find((n)=>n.id === id);
    if(node){
      node.data = data;
    }
    return _nodes;
  })
}

export function removeEdge(id) {
  edges.update((_edges) => {
    const index = _edges.findIndex((e) => e.id === id);
    _edges.splice(index, 1);
    return _edges;
  });
}

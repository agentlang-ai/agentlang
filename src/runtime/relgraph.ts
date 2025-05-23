import {
  DefaultModuleName,
  fetchModule,
  getUserModuleNames,
  RelationshipEntry,
  RelNodeEntry,
  RuntimeModule,
} from './module.js';
import { Path } from './util.js';

export type RelationshipGraphNode = {
  entity: Path;
  edges: RelationshipGraphEdge[];
};

export type RelationshipGraphEdge = {
  relationship: RelationshipEntry;
  node: RelationshipGraphNode;
};

export type RelationshipGraph = {
  nodes: RelationshipGraphNode[];
};

const NullEdge: Array<RelationshipGraphEdge> = [];
const EmptyGraph: RelationshipGraph = {
  nodes: new Array<RelationshipGraphNode>(),
};

export function buildGraph(moduleName: string): RelationshipGraph {
  if (moduleName == DefaultModuleName) return EmptyGraph;
  const rootEnts: Set<string> = new Set();
  const inRels: Set<string> = new Set();
  const nodes: Array<RelationshipGraphNode> = [];
  let localMod: RuntimeModule | undefined;
  getUserModuleNames().forEach((n: string) => {
    const m: RuntimeModule = fetchModule(n);
    if (n == moduleName) localMod = m;
    const rels: RelationshipEntry[] = m.getContainsRelationshipEntries();
    rels.forEach((re: RelationshipEntry) => {
      const n1: RelNodeEntry = re.parentNode();
      const n2: RelNodeEntry = re.childNode();
      if (n1.path.getModuleName() == moduleName) {
        rootEnts.add(n1.path.getEntryName());
        if (n2.path.getModuleName() == moduleName) {
          const en: string = n2.path.getEntryName();
          if (rootEnts.has(en)) {
            rootEnts.delete(en);
            inRels.add(en);
          }
        }
        const node: RelationshipGraphNode = forceFindNode(nodes, n1.path);
        connectEdge(node, re);
      }
    });
  });
  if (localMod == undefined) {
    throw new Error(`Failed to find module ${moduleName}`);
  }
  const remEnts: Set<string> = new Set(localMod.getEntityNames()).difference(inRels);
  remEnts.forEach((n: string) => {
    const rn: RelationshipGraphNode = {
      entity: new Path(moduleName, n),
      edges: NullEdge,
    };
    nodes.push(rn);
  });
  return { nodes: nodes };
}

function forceFindNode(nodes: Array<RelationshipGraphNode>, path: Path) {
  for (let i = 0; i < nodes.length; ++i) {
    const n: RelationshipGraphNode = nodes[i];
    if (n.entity == path) {
      return n;
    } else {
      const n0: RelationshipGraphNode | undefined = findNodeInEdges(n.edges, path);
      if (n0) return n0;
    }
  }
  const n: RelationshipGraphNode = {
    entity: path,
    edges: NullEdge,
  };
  nodes.push(n);
  return n;
}

function findNodeInEdges(
  edges: Array<RelationshipGraphEdge>,
  path: Path
): RelationshipGraphNode | undefined {
  for (let i = 0; i < edges.length; ++i) {
    const e: RelationshipGraphEdge = edges[i];
    if (e.node.entity == path) {
      return e.node;
    }
    const r: RelationshipGraphNode | undefined = findNodeInEdges(e.node.edges, path);
    if (r) return r;
  }
  return undefined;
}

function connectEdge(node: RelationshipGraphNode, re: RelationshipEntry) {
  const cn: RelNodeEntry = re.childNode();
  const n: RelationshipGraphNode = {
    entity: cn.path,
    edges: NullEdge,
  };
  const e: RelationshipGraphEdge = {
    relationship: re,
    node: n,
  };
  if (node.edges == NullEdge) {
    node.edges = new Array<RelationshipGraphEdge>();
  }
  node.edges.push(e);
}

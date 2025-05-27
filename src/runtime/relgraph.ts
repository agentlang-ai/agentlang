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

type GraphEdgeEntry = {
  relationship: string;
  type: 'contains' | 'between';
  to: object;
};

function asEdgeEntry(rge: RelationshipGraphEdge): GraphEdgeEntry {
  const nm: Map<string, any> = new Map();
  nm.set(rge.node.entity.asFqName(), rge.node.edges.map(asEdgeEntry));
  const e: GraphEdgeEntry = {
    relationship: rge.relationship.getFqName(),
    type: rge.relationship.isContains() ? 'contains' : 'between',
    to: Object.fromEntries(nm),
  };
  return e;
}

export class RelationshipGraph {
  nodes: RelationshipGraphNode[];

  constructor(nodes: Array<RelationshipGraphNode>) {
    this.nodes = nodes;
  }

  getRoots(): RelationshipGraphNode[] {
    return this.nodes;
  }

  asObject(): object {
    const result: Map<string, any> = new Map();
    this.nodes.forEach((node: RelationshipGraphNode) => {
      result.set(node.entity.asFqName(), node.edges.map(asEdgeEntry));
    });
    return Object.fromEntries(result);
  }

  private walkEdges(
    node: RelationshipGraphNode,
    onNode: Function,
    onContainsRelationship: Function,
    onBetweenRelationship: Function
  ) {
    const n = node.entity.asFqName();
    onNode(n);
    node.edges.forEach((edge: RelationshipGraphEdge) => {
      const rf: Function = edge.relationship.isContains()
        ? onContainsRelationship
        : onBetweenRelationship;
      rf(n, edge.node.entity.asFqName(), edge.relationship);
      this.walkEdges(edge.node, onNode, onContainsRelationship, onBetweenRelationship);
    });
  }

  walk(onNode: Function, onContainsRelationship: Function, onBetweenRelationship: Function) {
    this.nodes.forEach((node: RelationshipGraphNode) => {
      this.walkEdges(node, onNode, onContainsRelationship, onBetweenRelationship);
    });
  }
}

const NullEdge: Array<RelationshipGraphEdge> = [];
const EmptyGraph: RelationshipGraph = new RelationshipGraph(new Array<RelationshipGraphNode>());

export function buildGraph(moduleName: string): RelationshipGraph {
  if (moduleName == DefaultModuleName) return EmptyGraph;
  const rootEnts: Set<string> = new Set();
  const inRels: Set<string> = new Set();
  const nodes: Array<RelationshipGraphNode> = [];
  let localMod: RuntimeModule | undefined;
  getUserModuleNames().forEach((n: string) => {
    const m: RuntimeModule = fetchModule(n);
    if (n == moduleName) localMod = m;
    const rels: RelationshipEntry[] = m.getRelationshipEntries();
    rels.forEach((re: RelationshipEntry) => {
      const n1: RelNodeEntry = re.parentNode();
      const n2: RelNodeEntry = re.childNode();
      if (n1.path.getModuleName() == moduleName) {
        const nn: string = n1.path.getEntryName();
        if (!inRels.has(nn)) rootEnts.add(nn);
        if (n2.path.getModuleName() == moduleName) {
          const en: string = n2.path.getEntryName();
          if (rootEnts.has(en)) {
            rootEnts.delete(en);
          }
          if (re.isContains()) inRels.add(en);
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
    if (!rootEnts.has(n)) {
      const rn: RelationshipGraphNode = {
        entity: new Path(moduleName, n),
        edges: NullEdge,
      };
      nodes.push(rn);
    }
  });
  return new RelationshipGraph(nodes);
}

function forceFindNode(nodes: Array<RelationshipGraphNode>, path: Path) {
  for (let i = 0; i < nodes.length; ++i) {
    const n: RelationshipGraphNode = nodes[i];
    if (n.entity.equals(path)) {
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
    if (e.node.entity.equals(path)) {
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

export function findEdgeForRelationship(
  relName: string,
  moduleName: string,
  edges: RelationshipGraphEdge[]
): RelationshipGraphEdge | undefined {
  return edges.find((v: RelationshipGraphEdge) => {
    return v.relationship.moduleName == moduleName && v.relationship.name == relName;
  });
}

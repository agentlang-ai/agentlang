import { logger } from '../logger.js';
import type { GraphDatabase } from '../graph/database.js';
import type { GraphData, GraphNodeViz, GraphLinkViz } from '../graph/types.js';
import { getNodeColor } from './color-schemes.js';
import { isNodeEnv } from '../../utils/runtime.js';

export class GraphVisualizer {
  private graphDb: GraphDatabase;

  constructor(graphDb: GraphDatabase) {
    this.graphDb = graphDb;
  }

  async getGraphData(containerTag: string): Promise<GraphData> {
    if (!this.graphDb.isConnected()) {
      return { nodes: [], links: [] };
    }

    const allNodes = await this.graphDb.findNodesByContainer(containerTag);
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    const nodes: GraphNodeViz[] = allNodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.entityType,
      color: getNodeColor(n.entityType),
      description: n.description,
    }));

    const links: GraphLinkViz[] = [];
    for (const node of allNodes) {
      const edges = await this.graphDb.findOutgoingEdges(node.id);
      for (const edge of edges) {
        if (nodeMap.has(edge.targetId)) {
          links.push({
            source: edge.sourceId,
            target: edge.targetId,
            relation: edge.relationship,
            weight: edge.weight,
          });
        }
      }
    }

    return { nodes, links };
  }

  async visualize(containerTag: string, outputPath?: string): Promise<string> {
    const data = await this.getGraphData(containerTag);
    const html = this.generateHTML(data);

    if (isNodeEnv && outputPath) {
      try {
        const fs = await import('fs');
        fs.writeFileSync(outputPath, html, 'utf8');
        logger.info(`[VISUALIZATION] Graph written to ${outputPath}`);
        return outputPath;
      } catch (err) {
        logger.warn(`[VISUALIZATION] Failed to write file: ${err}`);
      }
    }

    return html;
  }

  generateHTML(data: GraphData): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Agentlang Knowledge Graph</title>
  <script src="https://d3js.org/d3.v5.min.js"></script>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; background: #1a1a2e; font-family: sans-serif; }
    svg { width: 100vw; height: 100vh; }
    .links line { stroke: rgba(160, 160, 160, 0.25); stroke-width: 1.5px; }
    .nodes circle { stroke: white; stroke-width: 0.5px; cursor: pointer; }
    .node-label { font-size: 10px; fill: #F4F4F4; text-anchor: middle; pointer-events: none; }
    .edge-label { font-size: 8px; fill: #D8D8D8; text-anchor: middle; pointer-events: none; }
    #tooltip {
      position: absolute; padding: 8px; background: rgba(0,0,0,0.9);
      color: white; border-radius: 4px; pointer-events: none;
      opacity: 0; transition: opacity 0.2s; font-size: 12px;
    }
    #stats {
      position: fixed; top: 10px; left: 10px; color: #888; font-size: 12px;
    }
  </style>
</head>
<body>
  <svg></svg>
  <div id="tooltip"></div>
  <div id="stats">Nodes: ${data.nodes.length} | Edges: ${data.links.length}</div>
  <script>
    const nodes = ${JSON.stringify(data.nodes)};
    const links = ${JSON.stringify(data.links)};

    const svg = d3.select("svg");
    const width = window.innerWidth;
    const height = window.innerHeight;
    const container = svg.append("g");

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(20));

    const link = container.append("g").attr("class", "links")
      .selectAll("line").data(links).enter().append("line")
      .attr("stroke-width", d => Math.sqrt(d.weight || 1));

    const edgeLabel = container.append("g").selectAll("text")
      .data(links).enter().append("text")
      .attr("class", "edge-label").text(d => d.relation);

    const node = container.append("g").attr("class", "nodes")
      .selectAll("circle").data(nodes).enter().append("circle")
      .attr("r", 15).attr("fill", d => d.color)
      .call(d3.drag()
        .on("start", d => { if (!d3.event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", d => { d.fx = d3.event.x; d.fy = d3.event.y; })
        .on("end", d => { if (!d3.event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

    const nodeLabel = container.append("g").selectAll("text")
      .data(nodes).enter().append("text")
      .attr("class", "node-label")
      .text(d => d.name.length > 20 ? d.name.slice(0, 20) + "..." : d.name);

    const tooltip = d3.select("#tooltip");
    node.on("mouseover", function(d) {
      tooltip.html("<strong>" + d.name + "</strong><br/>Type: " + d.type + (d.description ? "<br/>" + d.description : ""))
        .style("left", (d3.event.pageX + 10) + "px")
        .style("top", (d3.event.pageY - 10) + "px")
        .style("opacity", 1);
    }).on("mouseout", () => tooltip.style("opacity", 0));

    svg.call(d3.zoom().on("zoom", () => container.attr("transform", d3.event.transform)));

    simulation.on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      edgeLabel.attr("x", d => (d.source.x + d.target.x) / 2)
               .attr("y", d => (d.source.y + d.target.y) / 2);
      node.attr("cx", d => d.x).attr("cy", d => d.y);
      nodeLabel.attr("x", d => d.x).attr("y", d => d.y + 25);
    });
  </script>
</body>
</html>`;
  }
}

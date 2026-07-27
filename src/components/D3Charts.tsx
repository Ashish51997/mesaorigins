/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

// ==========================================
// TYPES & INTERFACES
// ==========================================

export interface BarChartData {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartData {
  label: string;
  value: number;
  color: string;
}

export interface LineChartData {
  date: string;
  value: number;
  secondaryValue?: number;
}

// ==========================================
// 1. D3 BAR CHART WITH HOVER TOOLTIPS
// ==========================================

interface D3BarChartProps {
  data: BarChartData[];
  height?: number;
  yAxisLabel?: string;
}

export function D3BarChart({ data, height = 200, yAxisLabel }: D3BarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string; active: boolean } | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // Clear previous SVG content
    d3.select(containerRef.current).selectAll('svg').remove();

    const containerWidth = containerRef.current.getBoundingClientRect().width || 400;
    const margin = { top: 20, right: 15, bottom: 35, left: 50 };
    const width = containerWidth - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const svg = d3
      .select(containerRef.current)
      .append('svg')
      .attr('width', containerWidth)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Add subtle gridlines background
    const yGrid = d3.scaleLinear().domain([0, d3.max(data, (d) => d.value) || 100]).range([chartHeight, 0]);
    
    // Gridlines helper
    svg.append('g')
      .attr('class', 'grid')
      .attr('opacity', 0.1)
      .attr('stroke', '#cbd5e1')
      .call(
        d3.axisLeft(yGrid)
          .tickSize(-width)
          .tickFormat(() => '')
      );

    // X scale
    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.label))
      .range([0, width])
      .padding(0.35);

    // Y scale
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.value) * 1.15 || 100]) // Add 15% padding at top
      .range([chartHeight, 0]);

    // X Axis
    svg
      .append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(d3.axisBottom(x).tickSize(4))
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '10px')
      .attr('color', '#64748b')
      .selectAll('text')
      .attr('font-weight', '500');

    // Y Axis
    const yAxis = d3.axisLeft(y).ticks(5).tickSize(4);
    if (yAxisLabel === '%') {
      yAxis.tickFormat(d => `${d}%`);
    } else if (yAxisLabel === 'Kg') {
      yAxis.tickFormat(d => `${Number(d) >= 1000 ? `${(Number(d)/1000).toFixed(0)}k` : d}`);
    }

    svg
      .append('g')
      .call(yAxis)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '10px')
      .attr('color', '#64748b');

    // Gradient Definition
    const defs = svg.append('defs');
    data.forEach((d, i) => {
      const gradientId = `bar-gradient-${i}`;
      const baseColor = d.color || '#6366f1';
      const grad = defs.append('linearGradient')
        .attr('id', gradientId)
        .attr('x1', '0%')
        .attr('y1', '100%')
        .attr('x2', '0%')
        .attr('y2', '0%');
      
      grad.append('stop').attr('offset', '0%').attr('stop-color', baseColor).attr('stop-opacity', 0.6);
      grad.append('stop').attr('offset', '100%').attr('stop-color', baseColor).attr('stop-opacity', 0.95);
    });

    // Bars
    svg
      .selectAll('.bar')
      .data(data)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.label) || 0)
      .attr('width', x.bandwidth())
      .attr('y', chartHeight) // Animation start position
      .attr('height', 0)     // Animation start height
      .attr('rx', 4)          // Soft round corners
      .attr('ry', 4)
      .attr('fill', (d, i) => `url(#bar-gradient-${i})`)
      .attr('stroke', d => d.color || '#6366f1')
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('fill-opacity', 0.8)
          .attr('stroke-width', 2);

        const [mX, mY] = d3.pointer(event, containerRef.current);
        setTooltip({
          x: mX,
          y: mY - 40,
          text: `${d.label}: ${d.value.toLocaleString()} ${yAxisLabel || ''}`,
          active: true,
        });
      })
      .on('mousemove', function (event) {
        const [mX, mY] = d3.pointer(event, containerRef.current);
        setTooltip((prev) => prev ? { ...prev, x: mX, y: mY - 40 } : null);
      })
      .on('mouseout', function (event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr('fill-opacity', 1)
          .attr('stroke-width', 1);

        setTooltip(null);
      })
      // Ease-in entrance transition
      .transition()
      .duration(800)
      .delay((d, i) => i * 100)
      .attr('y', (d) => y(d.value))
      .attr('height', (d) => chartHeight - y(d.value));

    // Resize observer for responsiveness
    const handleResize = () => {
      if (!containerRef.current) return;
      const currentWidth = containerRef.current.getBoundingClientRect().width;
      if (Math.abs(currentWidth - containerWidth) > 10) {
        // Simple re-run
        // It's clean because of the clear previous step
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);

  }, [data, height, yAxisLabel]);

  return (
    <div className="relative w-full" ref={containerRef}>
      {tooltip && tooltip.active && (
        <div
          className="absolute z-50 bg-slate-900/95 border border-slate-700 text-white font-mono text-[10px] font-bold px-2 py-1 rounded shadow-md pointer-events-none transition-all duration-75"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px`, transform: 'translate(-50%, -100%)' }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 2. D3 DONUT CHART WITH CENTRAL METRIC & ROTATION
// ==========================================

interface D3DonutChartProps {
  data: DonutChartData[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
}

export function D3DonutChart({ data, height = 180, centerLabel, centerValue }: D3DonutChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeSegment, setActiveSegment] = useState<DonutChartData | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    d3.select(containerRef.current).selectAll('svg').remove();

    const containerWidth = containerRef.current.getBoundingClientRect().width || 180;
    const size = Math.min(containerWidth, height);
    const radius = size / 2;
    const innerRadius = radius * 0.65; // Donut style
    const outerRadius = radius * 0.9;

    const svg = d3
      .select(containerRef.current)
      .append('svg')
      .attr('width', containerWidth)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${containerWidth / 2},${height / 2})`);

    const pie = d3
      .pie<DonutChartData>()
      .value((d) => d.value)
      .sort(null); // Keep array order

    const arc = d3
      .arc<d3.PieArcDatum<DonutChartData>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius)
      .cornerRadius(4);

    const arcHover = d3
      .arc<d3.PieArcDatum<DonutChartData>>()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius * 1.08)
      .cornerRadius(4);

    // Draw donut segments
    const path = svg
      .selectAll('.arc')
      .data(pie(data))
      .enter()
      .append('g')
      .attr('class', 'arc');

    path
      .append('path')
      .attr('d', arc)
      .attr('fill', (d) => d.data.color)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2)
      .attr('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('d', arcHover)
          .attr('fill-opacity', 0.9);
        setActiveSegment(d.data);
      })
      .on('mouseout', function (event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('d', arc)
          .attr('fill-opacity', 1);
        setActiveSegment(null);
      })
      // Animate slice growth from angle 0
      .transition()
      .duration(850)
      .attrTween('d', function (d) {
        const interpolate = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
        return function (t) {
          return arc(interpolate(t)) || '';
        };
      });

  }, [data, height]);

  // Fallback center stats
  const totalValue = data.reduce((sum, d) => sum + d.value, 0);
  const displayVal = activeSegment ? `${activeSegment.value.toLocaleString()}` : centerValue || `${totalValue}`;
  const displayLbl = activeSegment ? activeSegment.label : centerLabel || 'Total';

  return (
    <div className="relative flex flex-col items-center justify-center" ref={containerRef}>
      {/* Absolute centered label */}
      <div className="absolute pointer-events-none flex flex-col items-center justify-center text-center">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest leading-none">
          {displayLbl}
        </span>
        <span className="text-lg font-bold text-slate-800 font-mono mt-1">
          {displayVal}
        </span>
      </div>
    </div>
  );
}

// ==========================================
// 3. D3 SMOOTH AREA LINE CHART WITH FOCUS HOVERS
// ==========================================

interface D3LineChartProps {
  data: LineChartData[];
  height?: number;
  yAxisLabel?: string;
  showArea?: boolean;
  color?: string;
}

export function D3LineChart({ data, height = 220, yAxisLabel, showArea = true, color = '#6366f1' }: D3LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; value: number; secValue?: number; active: boolean } | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    d3.select(containerRef.current).selectAll('svg').remove();

    const containerWidth = containerRef.current.getBoundingClientRect().width || 400;
    const margin = { top: 20, right: 25, bottom: 35, left: 55 };
    const width = containerWidth - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const svg = d3
      .select(containerRef.current)
      .append('svg')
      .attr('width', containerWidth)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // X Axis Scale (Time / Category)
    const x = d3
      .scalePoint()
      .domain(data.map((d) => d.date))
      .range([0, width]);

    // Max values across primary and optional secondary values
    const maxVal = d3.max(data, (d) => Math.max(d.value, d.secondaryValue || 0)) || 100;

    // Y Axis Scale (Continuous)
    const y = d3
      .scaleLinear()
      .domain([0, maxVal * 1.15])
      .range([chartHeight, 0]);

    // X Axis ticks
    svg
      .append('g')
      .attr('transform', `translate(0,${chartHeight})`)
      .call(
        d3.axisBottom(x)
          .tickSize(4)
          .tickFormat((d, i) => {
            // Keep labels legible: skip some if list is long
            if (data.length > 7) {
              return i % Math.ceil(data.length / 5) === 0 ? d : '';
            }
            return d;
          })
      )
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '9px')
      .attr('color', '#64748b');

    // Y Axis ticks
    const yAxis = d3.axisLeft(y).ticks(5).tickSize(4);
    if (yAxisLabel === '%') {
      yAxis.tickFormat(d => `${d}%`);
    } else if (yAxisLabel === 'Kg') {
      yAxis.tickFormat(d => `${Number(d) >= 1000 ? `${(Number(d)/1000).toFixed(1)}k` : d}`);
    }

    svg
      .append('g')
      .call(yAxis)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '9px')
      .attr('color', '#64748b');

    // Horizontal guidelines
    svg.append('g')
      .attr('opacity', 0.05)
      .attr('stroke', '#000000')
      .call(
        d3.axisLeft(y)
          .ticks(5)
          .tickSize(-width)
          .tickFormat(() => '')
      );

    // Defs for gradients
    const defs = svg.append('defs');
    
    // Area gradient
    const areaGrad = defs
      .append('linearGradient')
      .attr('id', 'line-area-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    areaGrad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.35);
    areaGrad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0.01);

    // Secondary line area gradient
    const secAreaGrad = defs
      .append('linearGradient')
      .attr('id', 'secondary-area-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    secAreaGrad.append('stop').attr('offset', '0%').attr('stop-color', '#f43f5e').attr('stop-opacity', 0.25);
    secAreaGrad.append('stop').attr('offset', '100%').attr('stop-color', '#f43f5e').attr('stop-opacity', 0.01);

    // Define line generators
    const lineGenerator = d3
      .line<LineChartData>()
      .x((d) => x(d.date) || 0)
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX);

    const secLineGenerator = d3
      .line<LineChartData>()
      .x((d) => x(d.date) || 0)
      .y((d) => y(d.secondaryValue || 0))
      .curve(d3.curveMonotoneX);

    // Define area generators
    const areaGenerator = d3
      .area<LineChartData>()
      .x((d) => x(d.date) || 0)
      .y0(chartHeight)
      .y1((d) => y(d.value))
      .curve(d3.curveMonotoneX);

    const secAreaGenerator = d3
      .area<LineChartData>()
      .x((d) => x(d.date) || 0)
      .y0(chartHeight)
      .y1((d) => y(d.secondaryValue || 0))
      .curve(d3.curveMonotoneX);

    // Render Area for secondary values first if available
    const hasSecondary = data.some((d) => d.secondaryValue !== undefined);
    if (hasSecondary && showArea) {
      svg
        .append('path')
        .datum(data)
        .attr('fill', 'url(#secondary-area-gradient)')
        .attr('d', secAreaGenerator)
        .attr('opacity', 0.7);
    }

    // Render Area for main values
    if (showArea) {
      svg
        .append('path')
        .datum(data)
        .attr('fill', 'url(#line-area-gradient)')
        .attr('d', areaGenerator);
    }

    // Secondary Line
    if (hasSecondary) {
      const secPath = svg
        .append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#f43f5e')
        .attr('stroke-width', 2.5)
        .attr('d', secLineGenerator);

      // Animate drawing line
      const totalLengthSec = secPath.node()?.getTotalLength() || 0;
      secPath
        .attr('stroke-dasharray', `${totalLengthSec} ${totalLengthSec}`)
        .attr('stroke-dashoffset', totalLengthSec)
        .transition()
        .duration(1200)
        .attr('stroke-dashoffset', 0);
    }

    // Primary Line
    const path = svg
      .append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 3)
      .attr('d', lineGenerator);

    // Animate drawing line
    const totalLength = path.node()?.getTotalLength() || 0;
    path
      .attr('stroke-dasharray', `${totalLength} ${totalLength}`)
      .attr('stroke-dashoffset', totalLength)
      .transition()
      .duration(1000)
      .attr('stroke-dashoffset', 0);

    // Focus overlay group for mouse tracking
    const focus = svg.append('g').style('display', 'none');
    
    // Vertical track line
    focus.append('line')
      .attr('class', 'focus-line')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .attr('y1', 0)
      .attr('y2', chartHeight);

    // Focus dots
    focus.append('circle').attr('class', 'focus-dot-main').attr('r', 5).attr('fill', color).attr('stroke', '#ffffff').attr('stroke-width', 1.5);
    if (hasSecondary) {
      focus.append('circle').attr('class', 'focus-dot-sec').attr('r', 5).attr('fill', '#f43f5e').attr('stroke', '#ffffff').attr('stroke-width', 1.5);
    }

    // Interactive transparency pane for hover interaction
    svg
      .append('rect')
      .attr('class', 'overlay')
      .attr('width', width)
      .attr('height', chartHeight)
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .attr('cursor', 'crosshair')
      .on('mouseover', () => focus.style('display', null))
      .on('mouseout', () => {
        focus.style('display', 'none');
        setTooltip(null);
      })
      .on('mousemove', function (event) {
        const [mx] = d3.pointer(event);
        
        // Find nearest point
        const domain = data.map((d) => d.date);
        const range = domain.map((d) => x(d) || 0);
        const idx = d3.bisectCenter(range, mx);
        const selected = data[idx];

        if (selected) {
          const sX = x(selected.date) || 0;
          
          focus.select('.focus-line').attr('x1', sX).attr('x2', sX);
          focus.select('.focus-dot-main').attr('cx', sX).attr('cy', y(selected.value));
          
          if (hasSecondary && selected.secondaryValue !== undefined) {
            focus.select('.focus-dot-sec').attr('cx', sX).attr('cy', y(selected.secondaryValue));
          }

          const [mX, mY] = d3.pointer(event, containerRef.current);
          setTooltip({
            x: mX,
            y: mY - 30,
            date: selected.date,
            value: selected.value,
            secValue: selected.secondaryValue,
            active: true,
          });
        }
      });

  }, [data, height, showArea, color, yAxisLabel]);

  return (
    <div className="relative w-full" ref={containerRef}>
      {tooltip && tooltip.active && (
        <div
          className="absolute z-50 bg-slate-900/95 border border-slate-700 text-white font-mono text-[10px] p-2.5 rounded shadow-lg pointer-events-none space-y-1"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px`, transform: 'translate(-50%, -100%)' }}
        >
          <div className="font-bold border-b border-slate-700 pb-1 text-slate-300">{tooltip.date}</div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }}></span>
            <span>Primary: <strong className="text-white">{tooltip.value.toLocaleString()}{yAxisLabel || ''}</strong></span>
          </div>
          {tooltip.secValue !== undefined && (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500"></span>
              <span>Secondary: <strong className="text-blue-300">{tooltip.secValue.toLocaleString()}{yAxisLabel || ''}</strong></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 4. D3 COMPACT RADIAL PROGRESS CIRCLE
// ==========================================

interface D3RadialProgressProps {
  value: number; // 0 to 100
  color?: string;
  size?: number;
  strokeWidth?: number;
}

export function D3RadialProgress({ value, color = '#6366f1', size = 80, strokeWidth = 8 }: D3RadialProgressProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    d3.select(containerRef.current).selectAll('svg').remove();

    const radius = size / 2;
    const innerRadius = radius - strokeWidth;

    const svg = d3
      .select(containerRef.current)
      .append('svg')
      .attr('width', size)
      .attr('height', size)
      .append('g')
      .attr('transform', `translate(${radius},${radius})`);

    // Background track circle
    const arcBg = d3
      .arc()
      .innerRadius(innerRadius)
      .outerRadius(radius)
      .startAngle(0)
      .endAngle(Math.PI * 2);

    svg.append('path').attr('d', arcBg as any).attr('fill', '#e2e8f0');

    // Filled path circle arc
    const arcFill = d3
      .arc()
      .innerRadius(innerRadius)
      .outerRadius(radius)
      .startAngle(0)
      .cornerRadius(2);

    const targetAngle = (value / 100) * Math.PI * 2;

    const fillPath = svg
      .append('path')
      .attr('fill', color)
      .attr('d', arcBg as any); // fallback

    // Dynamic rotation growth
    fillPath
      .transition()
      .duration(1200)
      .attrTween('d', function () {
        const interpolate = d3.interpolate(0, targetAngle);
        return function (t) {
          const currentArc = d3
            .arc()
            .innerRadius(innerRadius)
            .outerRadius(radius)
            .startAngle(0)
            .endAngle(interpolate(t))
            .cornerRadius(2);
          return currentArc(null as any) || '';
        };
      });

  }, [value, color, size, strokeWidth]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div ref={containerRef} />
      <div className="absolute font-mono text-xs font-bold text-slate-800">
        {Math.round(value)}%
      </div>
    </div>
  );
}

// ==========================================
// 5. D3 INDUSTRIAL METRIC GAUGE CHART (OEE, Yield)
// ==========================================

interface D3GaugeChartProps {
  value: number; // 0 to 100
  size?: number;
  label?: string;
}

export function D3GaugeChart({ value, size = 180, label = 'OEE' }: D3GaugeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    d3.select(containerRef.current).selectAll('svg').remove();

    const margin = 10;
    const width = size;
    const height = size * 0.75; // Shorter aspect ratio for half-dial
    const radius = Math.min(width, height * 2) / 2 - margin;
    const innerRadius = radius * 0.72;

    const svg = d3
      .select(containerRef.current)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width / 2},${height - 15})`);

    // Arc specifications for half-dial (-90 deg to 90 deg, or -Math.PI/2 to Math.PI/2)
    const startAngle = -Math.PI / 1.8;
    const endAngle = Math.PI / 1.8;

    // Create colored reference arcs (poor, medium, excellent)
    const gaugeScale = d3.scaleLinear().domain([0, 100]).range([startAngle, endAngle]);

    const arcGenerator = d3
      .arc()
      .innerRadius(innerRadius)
      .outerRadius(radius)
      .cornerRadius(4);

    // Background grey track
    svg.append('path')
      .datum({ startAngle, endAngle })
      .attr('d', arcGenerator as any)
      .attr('fill', '#f1f5f9')
      .attr('stroke', '#cbd5e1')
      .attr('stroke-width', 0.5);

    // Colored sectors: Red (<60%), Amber (60%-80%), Green (>=80%)
    const colors = [
      { start: 0, end: 60, color: '#f87171', opacity: 0.2 },
      { start: 60, end: 80, color: '#fbbf24', opacity: 0.35 },
      { start: 80, end: 100, color: '#34d399', opacity: 0.4 },
    ];

    colors.forEach(sec => {
      svg.append('path')
        .datum({
          startAngle: gaugeScale(sec.start),
          endAngle: gaugeScale(sec.end)
        })
        .attr('d', arcGenerator as any)
        .attr('fill', sec.color)
        .attr('opacity', sec.opacity);
    });

    // Main value active arc
    const targetAngle = gaugeScale(value);
    const activeColor = value < 60 ? '#f43f5e' : value < 80 ? '#d97706' : '#10b981';

    const activeArc = svg.append('path')
      .datum({ startAngle, endAngle: startAngle })
      .attr('fill', activeColor)
      .attr('d', arcGenerator as any);

    activeArc.transition()
      .duration(1200)
      .delay(100)
      .ease(d3.easeCubicOut)
      .attrTween('d', function() {
        const interpolate = d3.interpolate(startAngle, targetAngle);
        return function(t) {
          const currentArc = d3
            .arc()
            .innerRadius(innerRadius)
            .outerRadius(radius)
            .startAngle(startAngle)
            .endAngle(interpolate(t))
            .cornerRadius(4);
          return currentArc(null as any) || '';
        };
      });

    // Centered needle pivot circle
    svg.append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', 7)
      .attr('fill', '#334155');

    svg.append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', 3)
      .attr('fill', '#ffffff');

    // Drawing Needle indicator
    const needlePath = svg.append('line')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', -radius + 8)
      .attr('stroke', '#334155')
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('transform', `rotate(${(startAngle * 180) / Math.PI})`);

    const targetRotation = (targetAngle * 180) / Math.PI;
    needlePath.transition()
      .duration(1200)
      .delay(100)
      .ease(d3.easeCubicOut)
      .attr('transform', `rotate(${targetRotation})`);

    // Tick labels at 0, 50, 100
    const ticks = [0, 50, 100];
    ticks.forEach(t => {
      const angle = gaugeScale(t);
      const textRadius = innerRadius - 12;
      const xPos = Math.sin(angle) * textRadius;
      const yPos = -Math.cos(angle) * textRadius;

      svg.append('text')
        .attr('x', xPos)
        .attr('y', yPos)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-size', '8px')
        .attr('fill', '#94a3b8')
        .attr('font-weight', 'bold')
        .text(t);
    });

  }, [value, size]);

  return (
    <div className="flex flex-col items-center justify-center">
      <div ref={containerRef} />
      <div className="text-center -mt-3">
        <span className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">{label}</span>
        <span className="text-lg font-bold text-slate-800 font-mono">{value.toFixed(1)}%</span>
      </div>
    </div>
  );
}


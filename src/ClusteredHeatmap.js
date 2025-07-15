import React, { useState, useRef } from 'react';
import * as d3 from 'd3';
import * as XLSX from 'xlsx';
import { Card, Typography, Button, Box, Grid, Paper, Slider, FormControl, InputLabel, Select, MenuItem } from '@mui/material';

const ClusteredHeatmap = () => {
  // ... existing state declarations ...
  const [colWidthsState, setColWidthsState] = useState(null); // null until data loaded
  // ... other state ...


  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [colorScaleType, setColorScaleType] = useState('linear'); // linear, log, quantile
  const [fontSizes, setFontSizes] = useState({
    geneName: 12,
    header: 12,
    cellValue: 12,
    categoryName: 12
  });

  // Initialize column widths state if not set or if column count changed
  React.useEffect(() => {
    if (data && (!colWidthsState || colWidthsState.length !== (data.comparisons?.length || 0))) {
      // Recompute colWidthsRaw using current font sizes and data
      const headerFont = `bold ${fontSizes.header}px Arial`;
      const cellFont = `${fontSizes.foldChange}px Arial`;
      const minColWidth = 50;
      const colWidthsRaw = data.comparisons.map((comparison, j) => {
        let maxWidth = measureTextWidth(comparison, headerFont);
        data.genes.forEach(gene => {
          const value = gene.values[j];
          const text = value !== undefined && value !== null ? value.toFixed(1) : "N/A";
          maxWidth = Math.max(maxWidth, measureTextWidth(text, cellFont));
        });
        return Math.ceil(Math.max(maxWidth + 18, minColWidth));
      });
      setColWidthsState([...colWidthsRaw]);
    }
    // eslint-disable-next-line
  }, [data && data.comparisons?.length, fontSizes.header, fontSizes.foldChange]);

  const [selectedCells, setSelectedCells] = useState([]); // [{row, col}]
  const resizingCol = useRef(null); // Track which column is being resized
  const startX = useRef(null); // Track mouse X position on resize start
  const startWidth = useRef(null); // Track initial width on resize start
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, content: null });
  const svgRef = useRef(null);
  const exportContainerRef = useRef(null);


  // Enhanced color scale
  const colorScale = (value) => {
    if (value === undefined || value === null) return "#f9f9f9";
    let v = value;
    if (colorScaleType === 'log') {
      v = value === 0 ? 0 : (value > 0 ? Math.log2(Math.abs(value) + 1) : -Math.log2(Math.abs(value) + 1));
    } else if (colorScaleType === 'quantile' && data) {
      // Quantile scaling based on all values
      const allVals = data.genes.flatMap(g => g.values);
      const scale = d3.scaleQuantile().domain(allVals).range(d3.schemeRdBu[7].reverse());
      return scale(value);
    }
    if (v > 0) {
      const intensity = Math.min(Math.abs(v) / 3, 1);
      return d3.interpolateReds(intensity);
    } else {
      const intensity = Math.min(Math.abs(v) / 3, 1);
      return d3.interpolateBlues(intensity);
    }
  };


  // Handle file upload
  const handleFileUpload = (event) => {
    const selectedFile = event.target.files[0];
    if (!selectedFile) {
      setError('No file selected');
      return;
    }

    // Reset states
    setError(null);
    setFile(selectedFile);
    setLoading(true);
    
    // Log file info for debugging
    console.log('Processing file:', {
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type
    });

    // Basic file validation
    if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
      const errorMsg = 'Invalid file type. Please upload an Excel file (.xlsx or .xls)';
      console.error(errorMsg);
      setError(errorMsg);
      setLoading(false);
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) { // 10MB limit
      const errorMsg = 'File is too large. Maximum size is 10MB';
      console.error(errorMsg);
      setError(errorMsg);
      setLoading(false);
      return;
    }

    processExcelFile(selectedFile).catch(error => {
      console.error('Error processing file:', error);
      setError(`Error processing file: ${error.message || 'Unknown error'}`);
      setLoading(false);
    });
  };

  // Process the Excel file with enhanced error handling
  const processExcelFile = async (selectedFile) => {
    if (!selectedFile) {
      throw new Error('No file provided');
    }
    try {
      console.log('Reading Excel file...');
      const arrayBuffer = await selectedFile.arrayBuffer();
      let workbook, sheet, rawData;
      
      try {
        workbook = XLSX.read(new Uint8Array(arrayBuffer), { cellDates: true });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error('No sheets found in the Excel file');
        }
        
        sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
          throw new Error('Could not read the first sheet');
        }
        
        rawData = XLSX.utils.sheet_to_json(sheet);
        if (!rawData || rawData.length === 0) {
          throw new Error('No data found in the sheet');
        }
        
        console.log(`Successfully read ${rawData.length} rows of data`);
      } catch (err) {
        console.error('Error reading Excel file:', err);
        throw new Error(`Failed to read Excel file: ${err.message}`);
      }
      
      // Validate and extract headers
      const headers = Object.keys(rawData[0] || {});
      if (headers.length === 0) {
        throw new Error('No headers found in the Excel file');
      }
      
      console.log('Detected headers:', headers);
      
      const comparisonPattern = /^Log2FC\s*\((.+)\)$/i;
      const pValuePattern = /^P value\s*\((.+)\)$/i;
      
      // Find all comparison columns and their display names
      const comparisons = headers.filter(h => comparisonPattern.test(h));
      if (comparisons.length === 0) {
        throw new Error('No comparison columns found. Expected columns with pattern: "Log2FC (ComparisonName)"');
      }
      
      const shortNames = comparisons.map(h => {
        const match = h.match(comparisonPattern);
        return match ? match[1].trim() : h;
      });
      
      // Find all p-value columns
      const pValueColumns = headers.filter(h => pValuePattern.test(h));
      if (pValueColumns.length === 0) {
        console.warn('No p-value columns found with pattern: "P value (ComparisonName)"');
      }
      
      // Dynamically determine the category column
      const categoryCol = headers.find(h => h.toLowerCase().includes('category'));
      if (!categoryCol) {
        console.warn('No category column found. Using "Uncategorized" for all genes');
      }
      
      // Sort comparisons and p-values by their order in the file
      // (Optional: you can sort by display name if you prefer)
      // If you want to pair Log2FC and P value columns by their inner comparison, you can add extra logic here.
      
      // Process gene data with validation
      const geneData = [];
      const missingGenes = [];
      
      rawData.forEach((gene, index) => {
        // Only accept rows with a valid gene ID (not empty/whitespace)
        let geneId = gene['Gene ID'] || gene['GeneID'] || gene['gene_id'];
        if (typeof geneId === 'string') geneId = geneId.trim();
        // Skip rows without a valid gene ID
        if (!geneId) {
          console.warn(`Skipping row ${index + 2}: Missing or blank Gene ID`);
          console.log('Problematic row data:', gene);
          return;
        }
        
        // Check for at least one valid value
        const hasValidValue = comparisons.some(comp => {
          const val = gene[comp];
          return val !== undefined && val !== null && val !== '';
        });
        
        if (!hasValidValue) {
          console.warn(`Gene ${geneId} has no valid comparison values`);
        }
        
        geneData.push({
          id: geneId,
          category: gene[categoryCol] || 'Uncategorized',
          values: comparisons.map(comp => {
            const val = gene[comp];
            return val !== undefined && val !== null && val !== '' ? parseFloat(val) : null;
          }),
          pValues: pValueColumns.map(comp => {
            const val = gene[comp];
            return val !== undefined && val !== null && val !== '' ? parseFloat(val) : null;
          })
        });
      });
      
      if (geneData.length === 0) {
        throw new Error('No valid gene data found in the file');
      }
      
      if (missingGenes.length > 0) {
        console.warn(`Missing Gene IDs in ${missingGenes.length} rows`);
        if (missingGenes.length === rawData.length) {
          throw new Error('No valid Gene IDs found in the file');
        }
      }
      
      // Group genes by category
      const categories = [...new Set(geneData.map(gene => gene.category))];
      const groupedByCategory = {};
      categories.forEach(category => {
        const genesInCategory = geneData.filter(gene => gene.category === category);
        if (genesInCategory.length > 0) {
          groupedByCategory[category] = genesInCategory;
        }
      });
      
      console.log(`Processed ${geneData.length} genes across ${categories.length} categories`);
      
      // Sort genes within each category from lowest to highest log2FC in the first comparison
      const sortedGeneData = [];
      categories.forEach(category => {
        if (!groupedByCategory[category]) return;
        const categoryGenes = groupedByCategory[category];
        
        // Sort genes within category from lowest to highest log2FC in first comparison
        categoryGenes.sort((a, b) => {
          // Sort by the value of the Control vs KD comparison (ascending)
          return a.values[0] - b.values[0];
        });
        
        // Add to the overall sorted data
        sortedGeneData.push(...categoryGenes);
      });
      
      // Create category groups for visualization
      const categoryGroups = [];
      let currentCategory = null;
      let startIndex = 0;
      
      sortedGeneData.forEach((gene, index) => {
        if (gene.category !== currentCategory) {
          if (currentCategory !== null) {
            categoryGroups.push({
              category: currentCategory,
              startIndex: startIndex,
              endIndex: index - 1,
              count: index - startIndex
            });
          }
          currentCategory = gene.category;
          startIndex = index;
        }
      });
      
      // Add the last group
      if (currentCategory !== null) {
        categoryGroups.push({
          category: currentCategory,
          startIndex: startIndex,
          endIndex: sortedGeneData.length - 1,
          count: sortedGeneData.length - startIndex
        });
      }
      
      // Debug: log all gene IDs after processing
      console.log('All processed gene IDs:', geneData.map(g => g.id));
      
      // Extract unique categories for category labels
      const uniqueCategories = Array.from(new Set(sortedGeneData.map(gene => gene.category)));
      console.log('Categories:', uniqueCategories);
      
      setData({
        genes: sortedGeneData,
        comparisons: shortNames,
        comparisonColumns: comparisons,
        pValueColumns: pValueColumns,
        categoryGroups: categoryGroups,
        categories: uniqueCategories
      });
      
      setLoading(false);
    } catch (err) {
      console.error('Error processing data:', err);
      setError('Failed to process gene expression data: ' + err.message);
      setLoading(false);
    }
  };
  
  // Download as SVG
  const downloadAsSVG = () => {
    if (!svgRef.current) return;
    
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    
    const downloadLink = document.createElement('a');
    downloadLink.href = svgUrl;
    downloadLink.download = 'gene_heatmap.svg';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(svgUrl);
  };
  
  // Download as PNG
  const downloadAsPNG = () => {
    if (!svgRef.current) return;
    
    const svg = svgRef.current;
    const width = svg.getAttribute('width');
    const height = svg.getAttribute('height');
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Create an image from the SVG
    const image = new Image();
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    
    image.onload = () => {
      // Fill the canvas with a white background
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw the image onto the canvas
      ctx.drawImage(image, 0, 0);
      
      // Convert canvas to PNG
      const pngUrl = canvas.toDataURL('image/png');
      
      // Trigger download
      const downloadLink = document.createElement('a');
      downloadLink.href = pngUrl;
      downloadLink.download = 'gene_heatmap.png';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      // Clean up
      URL.revokeObjectURL(svgUrl);
    };
    
    image.src = svgUrl;
  };

  // Default cell dimensions
  const cellHeight = Math.max(30, fontSizes.geneName + 10); // Ensure cell height is at least 10px larger than gene name font
  
  // Default margin values - actual left margin will be calculated in renderHeatmap
  const margin = { top: 100, right: 200, bottom: 50, left: 200 };



  // Significance indicator size scale
  const getSizeForPValue = (pValue) => {
    if (pValue >= 0.05) return 0;
    if (pValue < 0.01) return 5;
    return 3; // for p-values between 0.01 and 0.05
  };

  // Function to get background color for a category
  const getCategoryColor = (category) => {
    // Color code the category groups
    if (category.includes("Cholesterol")) {
      return "#e6f7ff"; // light blue
    } else if (category.includes("Fatty Acid")) {
      return "#e6ffe6"; // light green
    } else if (category.includes("Triglyceride")) {
      return "#fff2e6"; // light orange
    } else if (category.includes("Immune")) {
      return "#ffe6e6"; // light red
    } else if (category.includes("Carbohydrate")) {
      return "#f9f9e6"; // light yellow
    } else {
      return "#f0f0f0"; // default light gray
    }
  };

  // Utility function to measure text width using canvas
const measureTextWidth = (text, font = '11px Arial') => {
  const canvas = measureTextWidth.canvas || (measureTextWidth.canvas = document.createElement('canvas'));
  const context = canvas.getContext('2d');
  context.font = font;
  return context.measureText(text).width;
};

const renderHeatmap = () => {
  if (!data) return null;
  // Tooltip handler
  const handleMouseOver = (event, gene, j, i) => {
    setTooltip({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      content: (
        <Box sx={{ fontSize: 13 }}>
          <b>Gene:</b> {gene.id}<br/>
          <b>Category:</b> {gene.category}<br/>
          <b>Comparison:</b> {data.comparisons[j]}<br/>
          <b>Log2FC:</b> {gene.values[j] !== undefined && gene.values[j] !== null ? gene.values[j].toFixed(2) : 'N/A'}<br/>
          <b>P-value:</b> {gene.pValues[j] !== undefined && gene.pValues[j] !== null ? gene.pValues[j].toExponential(2) : 'N/A'}
        </Box>
      )
    });
  };
  const handleMouseOut = () => setTooltip({ ...tooltip, visible: false });
  // Selection handler
  const handleCellClick = (i, j) => {
    const idx = selectedCells.findIndex(c => c.row === i && c.col === j);
    if (idx >= 0) {
      setSelectedCells(selectedCells.filter((_, k) => k !== idx));
    } else {
      setSelectedCells([...selectedCells, { row: i, col: j }]);
    }
  };
  // Export selected cluster
  const exportSelection = () => {
    if (!selectedCells.length) return;
    const selectedGenes = Array.from(new Set(selectedCells.map(c => data.genes[c.row].id)));
    const rows = data.genes.filter((g, i) => selectedGenes.includes(g.id));
    const headers = ["Gene ID", "Category", ...data.comparisons.map(name => `Log2FC (${name})`), ...data.comparisons.map(name => `P-value (${name})`)];
    const outRows = rows.map(gene => {
      const log2fc = gene.values.map(v => v !== undefined && v !== null ? v : "N/A");
      const pvals = gene.pValues.map(v => v !== undefined && v !== null ? v : "N/A");
      const obj = { "Gene ID": gene.id, "Category": gene.category };
      data.comparisons.forEach((name, i) => {
        obj[`Log2FC (${name})`] = log2fc[i];
        obj[`P-value (${name})`] = pvals[i];
      });
      return obj;
    });
    const worksheet = window.XLSX ? window.XLSX.utils.json_to_sheet(outRows, { header: headers }) : XLSX.utils.json_to_sheet(outRows, { header: headers });
    const workbook = window.XLSX ? window.XLSX.utils.book_new() : XLSX.utils.book_new();
    (window.XLSX ? window.XLSX.utils : XLSX.utils).book_append_sheet(workbook, worksheet, "Selection");
    (window.XLSX ? window.XLSX : XLSX).writeFile(workbook, "selected_cluster.xlsx");
  };

  // ... rest of the function unchanged ...
  if (!data) return null;

  // Compute dynamic column widths, then use the largest for all columns
  const headerFont = `bold ${fontSizes.header}px Arial`;
  const cellFont = `${fontSizes.foldChange}px Arial`;
  const minColWidth = 50;
  // Calculate individual column widths
  const colWidthsRaw = data.comparisons.map((comparison, j) => {
    let maxWidth = measureTextWidth(comparison, headerFont);
    data.genes.forEach(gene => {
      const value = gene.values[j];
      const text = value !== undefined && value !== null ? value.toFixed(1) : "N/A";
      maxWidth = Math.max(maxWidth, measureTextWidth(text, cellFont));
    });
    // Add padding
    return Math.ceil(Math.max(maxWidth + 18, minColWidth));
  });

  // Use state for column widths if available
  const colWidths = colWidthsState || colWidthsRaw;

// --- Place this effect in the main component, not inside renderHeatmap ---
// (Move this block to the top-level ClusteredHeatmap body, after state declarations)

// --- END ---


  // Compute x positions for each column
  const colX = colWidths.reduce((acc, w, i) => {
    acc.push(i === 0 ? 0 : acc[i-1] + colWidths[i-1]);
    return acc;
  }, []);

  // --- Column resizing handlers ---
  const handleResizerMouseDown = (e, colIdx) => {
    resizingCol.current = colIdx;
    startX.current = e.clientX;
    startWidth.current = colWidths[colIdx];
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', handleResizerMouseMove);
    window.addEventListener('mouseup', handleResizerMouseUp);
    e.stopPropagation();
    e.preventDefault();
  };

  const handleResizerMouseMove = (e) => {
    if (resizingCol.current === null) return;
    const delta = e.clientX - startX.current;
    setColWidthsState(prev => {
      const newWidths = [...prev];
      newWidths[resizingCol.current] = Math.max(minColWidth, startWidth.current + delta);
      return newWidths;
    });
  };

  const handleResizerMouseUp = () => {
    resizingCol.current = null;
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', handleResizerMouseMove);
    window.removeEventListener('mouseup', handleResizerMouseUp);
  };
  const totalColsWidth = colWidths.reduce((a, b) => a + b, 0);
  
  // Calculate dynamic width based on content and font sizes - using gene name width only
  const geneNameFont = `${fontSizes.geneName}px Arial`;
  let maxGeneNameWidth = 100; // Default if no data
  if (data && data.genes && data.genes.length > 0) {
    // Find the maximum width of gene names
    maxGeneNameWidth = Math.max(...data.genes.map(gene => {
      return measureTextWidth(gene.id, geneNameFont);
    }));
  }
  
  const dynamicMargin = { ...margin, left: Math.max(100, maxGeneNameWidth + 30) };
  
  const width = dynamicMargin.left + totalColsWidth + dynamicMargin.right;
  const height = dynamicMargin.top + (cellHeight * data.genes.length) + dynamicMargin.bottom + 40;

return (
<div style={{ width: '100%', overflowX: 'auto', paddingTop: '20px' }} ref={exportContainerRef}>
{/* Color scale dropdown */}
<Box sx={{ mb: 2, p: 2, border: '1px solid #e0e0e0', borderRadius: 1, backgroundColor: '#f9f9f9' }}>
<Grid container spacing={3} alignItems="center">
<Grid item xs={12} sm={6} md={4}>
<Typography id="gene-name-slider" gutterBottom sx={{ fontSize: '0.875rem' }}>
Gene Name Size: {fontSizes.geneName}px
</Typography>
<Slider
value={fontSizes.geneName}
onChange={(e, value) => setFontSizes(prev => ({ ...prev, geneName: value }))}
aria-labelledby="gene-name-slider"
valueLabelDisplay="auto"
step={1}
marks
min={8}
max={20}
/>
</Grid>
<Grid item xs={12} sm={6} md={4}>
<Typography id="fold-change-slider" gutterBottom sx={{ fontSize: '0.875rem' }}>
Fold Change Size: {fontSizes.foldChange}px
</Typography>
<Slider
value={fontSizes.foldChange}
onChange={(e, value) => setFontSizes(prev => ({ ...prev, foldChange: value }))}
aria-labelledby="fold-change-slider"
valueLabelDisplay="auto"
step={1}
marks
min={8}
max={20}
/>
</Grid>
<Grid item xs={12} sm={6} md={4}>
<Typography id="header-slider" gutterBottom sx={{ fontSize: '0.875rem' }}>
Header Size: {fontSizes.header}px
</Typography>
<Slider
value={fontSizes.header}
onChange={(e, value) => setFontSizes(prev => ({ ...prev, header: value }))}
aria-labelledby="header-slider"
valueLabelDisplay="auto"
step={1}
marks
min={8}
max={20}
/>
</Grid>
<Grid item xs={12} sm={6} md={4}>
<Typography id="category-name-slider" gutterBottom sx={{ fontSize: '0.875rem' }}>
Category Name Size: {fontSizes.categoryName}px
</Typography>
<Slider
value={fontSizes.categoryName}
onChange={(e, value) => setFontSizes(prev => ({ ...prev, categoryName: value }))}
aria-labelledby="category-name-slider"
valueLabelDisplay="auto"
step={1}
marks
min={8}
max={20}
/>
</Grid>
<Grid item xs={12} sm={6} md={4}>
<FormControl fullWidth size="small" variant="outlined">
<InputLabel id="color-scale-label">Color Scale</InputLabel>
<Select
labelId="color-scale-label"
value={colorScaleType}
onChange={e => setColorScaleType(e.target.value)}
label="Color Scale"
sx={{ minWidth: 200 }}
>
<MenuItem value="linear">Linear</MenuItem>
<MenuItem value="log">Log</MenuItem>
<MenuItem value="quantile">Quantile</MenuItem>
</Select>
</FormControl>
</Grid>
<Grid item xs={12} sm={6} md={4} display="flex" alignItems="center">
<Button 
variant="contained" 
onClick={exportSelection} 
disabled={!selectedCells.length}
size="small"
sx={{ mr: 2 }}
>
Export Selection
</Button>
<Typography variant="body2" color="text.secondary">
{selectedCells.length} selected
</Typography>
</Grid>
</Grid>
</Box>
<div style={{
display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
margin: '0 auto 18px auto', maxWidth: 500, background: '#f9f9fc', border: '1px solid #dbeafe',
borderRadius: 8, padding: '14px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', fontSize: 14
}}>
{/* ... rest of the code remains the same ... */}
        <div style={{fontWeight:'bold', marginBottom: 6, color:'#1976d2'}}>What do the color scales mean?</div>
        <table style={{width:'100%', borderCollapse:'collapse', marginBottom:8, fontSize:13}}>
          <thead>
            <tr style={{background:'#f1f5fa'}}>
              <th style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Scale</th>
              <th style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Best for...</th>
              <th style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Effect</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Linear</td>
              <td style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Evenly distributed data</td>
              <td style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Proportional color mapping, outliers dominate</td>
            </tr>
            <tr>
              <td style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Log</td>
              <td style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Wide range, outliers present</td>
              <td style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Compresses large values, reveals subtle changes</td>
            </tr>
            <tr>
              <td style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Quantile</td>
              <td style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Skewed data, relative ranking</td>
              <td style={{border:'1px solid #e5e7eb', padding:'2px 6px'}}>Balanced color usage, highlights rankings</td>
            </tr>
          </tbody>
        </table>
        <div style={{fontSize:12, color:'#444'}}>
          <b>Linear:</b> Maps values directly to color. Best for proportional differences.<br/>
          <b>Log:</b> Log-transform compresses large values, expands small ones. Reveals subtle changes.<br/>
          <b>Quantile:</b> Divides data into equal-sized groups. Highlights rankings, not absolute differences.
        </div>
      </div>
      <svg width={width} height={height} ref={svgRef}>
        <g className="heatmap-zoomable" transform={`translate(${margin.left}, ${margin.top})`}>
          {/* Column Headers (Comparisons) */}
          {data.comparisons.map((comparison, j) => {
            // Word wrap header text to fit colWidths[j]
            const wrapHeaderText = (text, maxWidth, font) => {
              const words = text.split(' ');
              const lines = [];
              let line = '';
              words.forEach(word => {
                const testLine = line ? line + ' ' + word : word;
                if (measureTextWidth(testLine, font) > maxWidth - 8 && line) {
                  lines.push(line);
                  line = word;
                } else {
                  line = testLine;
                }
              });
              if (line) lines.push(line);
              return lines;
            };
            const headerFont = `bold ${fontSizes.header}px Arial`;
            const headerLines = wrapHeaderText(comparison, colWidths[j], headerFont);
            return (
              <g key={`col-${j}`} transform={`translate(${colX[j]}, 0)`}>
                <text
                  x={colWidths[j] / 2}
                  y={-20 - (headerLines.length - 1) * fontSizes.header / 2}
                  textAnchor="middle"
                  fontWeight="bold"
                  fontSize={`${fontSizes.header}px`}
                  style={{ userSelect: 'none' }}
                >
                  {headerLines.map((line, idx) => (
                    <tspan key={idx} x={colWidths[j] / 2} dy={idx === 0 ? 0 : fontSizes.header}>
                      {line}
                    </tspan>
                  ))}
                </text>
                {/* Resizer handle */}
                <rect
                  x={colWidths[j] - 6}
                  y={-35}
                  width={8}
                  height={cellHeight * data.genes.length + 40}
                  fill="transparent"
                  style={{ cursor: 'col-resize' }}
                  onMouseDown={e => handleResizerMouseDown(e, j)}
                />
                <rect
                  x={colWidths[j] - 3}
                  y={-35}
                  width={2}
                  height={cellHeight * data.genes.length + 40}
                  fill="#b0b0b0"
                  pointerEvents="none"
                />
              </g>
            );
          })}

          {/* Legend - moved up slightly */}
          <g transform={`translate(0, ${-75})`}>
            <text x={0} y={0} fontWeight="bold" fontSize="13px">Legend:</text>
            {/* Color legend */}
            <g transform="translate(70, 0)">
              {[-3, -2, -1, 0, 1, 2, 3].map((value, i) => (
                <g key={`legend-${i}`} transform={`translate(${i * 35}, 0)`}>
                  <rect
                    width={30}
                    height={15}
                    fill={value < 0 ? d3.interpolateBlues(Math.abs(value)/3) : 
                          value > 0 ? d3.interpolateReds(Math.abs(value)/3) : "#f9f9f9"}
                    stroke="#ccc"
                    strokeWidth="0.5"
                  />
                  <text
                    x={15}
                    y={30}
                    textAnchor="middle"
                    fontSize="10px"
                  >
                    {value}
                  </text>
                </g>
              ))}
              <text x={120} y={-5} fontSize="11px">Log₂ Fold Change</text>
            </g>
            {/* Significance legend */}
            <g transform="translate(350, 0)">
              <text x={0} y={0} fontSize="11px">p-value:</text>
              <circle cx={60} cy={-4} r={5} fill="black" opacity={0.8} />
              <text x={70} y={0} fontSize="11px">p &lt; 0.01</text>
              <circle cx={130} cy={-4} r={3} fill="black" opacity={0.8} />
              <text x={140} y={0} fontSize="11px">p &lt; 0.05</text>
            </g>
          </g>
          {/* Category labels are now rendered inside the renderHeatmap function */}
          {/* Vertical category labels along gene names */}
          {data.categories && data.categories.map((category, categoryIndex) => {
            // Find the first gene with this category
            const firstGeneIndex = data.genes.findIndex(gene => gene.category === category);
            if (firstGeneIndex === -1) return null; // Skip if no genes in this category
            
            // Count genes in this category
            const genesInCategory = data.genes.filter(gene => gene.category === category).length;
            
            // Calculate the position and dimensions of this category group
            const yStart = firstGeneIndex * cellHeight;
            const categoryHeight = genesInCategory * cellHeight;
            
            // Get background color for this category
            const categoryColor = getCategoryColor(category);
            
            return (
              <g key={`cat-label-${categoryIndex}`}>
                {/* Vertical category box aligned with first and last gene */}
                <g>
                  {/* Function to render vertical category box and label */}
                  {(() => {
                    // Calculate positions based on first and last gene in category
                    const yStart = firstGeneIndex * cellHeight;
                    
                    // Gap between gene names and category box
                    const gap = 5;
                    
                    // Width of the category box (vertical height when rotated)
                    const boxWidth = 30;
                    
                    // Position to align with gene names
                    const xPosition = -gap;
                    
                    // Combine category name and count
                    const labelText = `${category} (${genesInCategory})`;
                    
                    // Calculate text width for proper font sizing
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    context.font = `bold ${fontSizes.categoryName}px Arial`;
                    const textWidth = context.measureText(labelText).width;
                    
                    // Calculate if text fits in the box
                    const availableSpace = categoryHeight - 10; // 5px padding on each end
                    
                    // Determine appropriate font size to fit text
                    let fontSize = fontSizes.categoryName;
                    if (textWidth > availableSpace) {
                      // Scale down font size to fit
                      fontSize = Math.max(8, Math.floor(fontSizes.categoryName * (availableSpace / textWidth)));
                    }
                    
                    return (
                      <>
                        {/* Vertical background box aligned with first and last gene */}
                        <rect
                          x={xPosition - boxWidth}
                          y={yStart}
                          width={boxWidth}
                          height={categoryHeight}
                          fill={categoryColor}
                          stroke="#888"
                          strokeWidth="1"
                          rx={3}
                        />
                        
                        {/* Rotated category text centered in the box */}
                        <text
                          transform={`translate(${xPosition - boxWidth/2}, ${yStart + categoryHeight/2}) rotate(-90)`}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontWeight="bold"
                          fontSize={`${fontSize}px`}
                          fill="#333"
                        >
                          {labelText}
                        </text>
                      </>
                    );
                  })()}
                </g>
                
                {/* Add a subtle background for the entire category group */}
                <rect
                  x={0}
                  y={yStart}
                  width={totalColsWidth}
                  height={categoryHeight}
                  fill={categoryColor}
                  fillOpacity="0.1"
                  stroke="none"
                />
              </g>
            );
          })}
          
          {/* Gene cells */}
          {data.genes.map((gene, i) => (
            <g key={`row-${i}`} transform={`translate(0, ${i * cellHeight})`}>
              {/* Gene names */}
              <text
                x={-15}
                y={cellHeight / 2 + 5}
                textAnchor="end"
                fontSize={`${fontSizes.geneName}px`}
              >
                {gene.id}
              </text>
              {/* Gene expression cells */}
              {gene.values.map((value, j) => {
                const pValue = gene.pValues[j];
                const isSignificant = pValue < 0.05;
                const isMarginal = pValue >= 0.05 && pValue < 0.1;
                const circleRadius = isSignificant ? getSizeForPValue(pValue) : (isMarginal ? 2 : 0);
                return (
                  <g key={`cell-${i}-${j}`} transform={`translate(${colX[j]}, 0)`}>
                    <rect
                      width={colWidths[j] - 1}
                      height={cellHeight - 1}
                      fill={colorScale(value)}
                      stroke={selectedCells.some(c => c.row === i && c.col === j) ? "#ff9800" : "#fff"}
                      strokeWidth={selectedCells.some(c => c.row === i && c.col === j) ? 3 : 1}
                      style={{cursor:'pointer'}}
                      onClick={() => handleCellClick(i, j)}
                      onMouseOver={e => handleMouseOver(e, gene, j, i)}
                      onMouseOut={handleMouseOut}
                    />
                    <text
                      x={colWidths[j] / 2}
                      y={cellHeight / 2 + 4}
                      textAnchor="middle"
                      fontSize={`${fontSizes.foldChange}px`}
                      fontWeight={isSignificant ? "bold" : "normal"}
                      fill={Math.abs(value) > 1.5 ? "white" : "black"}
                    >
                      {value !== undefined && value !== null ? value.toFixed(1) : "N/A"}
                    </text>
                    {(isSignificant || isMarginal) && (
                      <circle
                        cx={colWidths[j] - 15}
                        cy={cellHeight / 2}
                        r={circleRadius}
                        fill={isSignificant ? "black" : "#888"}
                        opacity={0.8}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

  // Download all processed data as XLSX
  const downloadProcessedData = () => {
    if (!data) return;
    const headers = [
      "Gene ID",
      "Category",
      ...data.comparisons.map(name => `Log2FC (${name})`),
      ...data.comparisons.map(name => `P-value (${name})`)
    ];
    const outRows = data.genes.map(gene => {
      const log2fc = gene.values.map(v => v !== undefined && v !== null ? v : "N/A");
      const pvals = gene.pValues.map(v => v !== undefined && v !== null ? v : "N/A");
      const obj = {
        "Gene ID": gene.id,
        "Category": gene.category
      };
      data.comparisons.forEach((name, i) => {
        obj[`Log2FC (${name})`] = log2fc[i];
        obj[`P-value (${name})`] = pvals[i];
      });
      return obj;
    });
    const worksheet = window.XLSX ? window.XLSX.utils.json_to_sheet(outRows, { header: headers }) : XLSX.utils.json_to_sheet(outRows, { header: headers });
    const workbook = window.XLSX ? window.XLSX.utils.book_new() : XLSX.utils.book_new();
    (window.XLSX ? window.XLSX.utils : XLSX.utils).book_append_sheet(workbook, worksheet, "Processed Data");
    (window.XLSX ? window.XLSX : XLSX).writeFile(workbook, "processed_gene_data.xlsx");
  };

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', mt: 6, mb: 6, p: 2 }}>
    <Card elevation={3} sx={{ p: 4, borderRadius: 3 }}>
      {/* Upload and Instructions Section */}
      <Box mb={3}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Clustered Heatmap of Gene Expression
        </Typography>
        <Typography variant="body1" color="text.secondary" gutterBottom>
          Upload an Excel file containing gene expression data to visualize the clustered heatmap.
        </Typography>
        <Box component="ul" sx={{ fontSize: 13, color: 'text.secondary', pl: 3, mb: 1 }}>
          <li><b>Gene ID</b> — Unique gene identifier</li>
          <li><b>Log2FC (Condition Name)</b> — Log2 fold change for each comparison. The column header should be in the format <code>Log2FC (Comparison Name)</code> (e.g., <code>Log2FC (Control vs KD)</code>)</li>
          <li><b>P value (Condition Name)</b> — P-value for each comparison. The column header should be in the format <code>P value (Comparison Name)</code> (e.g., <code>P value (Control vs KD)</code>)</li>
          <li><b>All Gene Ontology Category</b> — Category or pathway for each gene (e.g., "Triglyceride Metabolism")</li>
        </Box>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>
          <b>Example of required column headers:</b><br />
          <code>Gene ID</code>, <code>All Gene Ontology Category</code>, <code>Log2FC (Control vs KD)</code>, <code>P value (Control vs KD)</code>, <code>Log2FC (KD vs Rescue)</code>, <code>P value (KD vs Rescue)</code>, ...
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
          You may include additional columns if you wish. The app will automatically detect all comparisons and p-value columns based on their headers.
        </Typography>
        <Button
          variant="outlined"
          component="label"
          sx={{ mb: 1 }}
        >
          Upload Excel File
          <input
            type="file"
            accept=".xlsx, .xls"
            hidden
            onChange={handleFileUpload}
          />
        </Button>
        {file && (
          <Typography sx={{ mt: 1, fontSize: 13, color: 'primary.main' }}>
            Using file: {file.name}
          </Typography>
        )}
      </Box>

      {/* Loading State */}
      {loading && (
        <Box py={6} textAlign="center">
          <Typography variant="body1" color="text.secondary">
            Loading gene expression data...
          </Typography>
        </Box>
      )}

      {/* Error State */}
      {error && (
        <Box sx={{ background: '#ffebee', color: '#c62828', p: 2, borderRadius: 2 }}>
          {error}
        </Box>
      )}

      {/* Main Content: Heatmap, Buttons, Legend */}
      {data && (
        <>
          {renderHeatmap()}

          {/* Export buttons */}
          <Grid container spacing={2} justifyContent="center" sx={{ mt: 2 }}>
            <Grid item>
              <Button variant="contained" color="primary" onClick={downloadAsSVG}>
                Download as SVG
              </Button>
            </Grid>
            <Grid item>
              <Button variant="contained" color="success" onClick={downloadAsPNG}>
                Download as PNG
              </Button>
            </Grid>
            <Grid item>
              <Button variant="contained" color="warning" onClick={downloadProcessedData}>
                Download Processed Data (XLSX)
              </Button>
            </Grid>
          </Grid>

          <Paper elevation={1} sx={{ mt: 4, p: 2, background: '#f9fafb' }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Visualization Legend:
            </Typography>
            <Box component="ul" sx={{ fontSize: 14, color: 'text.secondary', pl: 3, mb: 0 }}>
              <li>Genes are grouped by biological process and sorted from lowest to highest log₂FC in the Control vs KD comparison</li>
              <li>Red indicates upregulation (positive log₂FC), blue indicates downregulation (negative log₂FC)</li>
              <li>Color intensity corresponds to the magnitude of change</li>
              <li>Black circles indicate statistical significance (p &lt; 0.05), with size proportional to significance level</li>
              <li>Larger circles (p &lt; 0.01) indicate higher statistical significance</li>
            </Box>
            <Typography sx={{ fontSize: 13, mt: 1 }}>
              • The heatmap reveals patterns of gene expression changes across different biological processes and experimental conditions<br />
              • This visualization helps identify coordinated regulation within functional pathways
            </Typography>
          </Paper>
        </>
      )}

      {/* Tooltip overlay */}
      {tooltip.visible && (
        <Box
          sx={{
            position: 'fixed',
            left: tooltip.x + 10,
            top: tooltip.y + 10,
            background: 'rgba(255,255,255,0.98)',
            border: '1px solid #ccc',
            borderRadius: 1.5,
            p: 1.5,
            pointerEvents: 'none',
            zIndex: 10000,
            boxShadow: 3,
            minWidth: 200
          }}
        >
          {tooltip.content}
        </Box>
      )}
    </Card>
  </Box>
  );
}
export default ClusteredHeatmap;
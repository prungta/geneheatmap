import React, { useState, useRef } from 'react';
import * as d3 from 'd3';
import * as XLSX from 'xlsx';

const ClusteredHeatmap = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const svgRef = useRef(null);
  const exportContainerRef = useRef(null);

  // Handle file upload
  const handleFileUpload = (event) => {
    const selectedFile = event.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setLoading(true);
      processExcelFile(selectedFile);
    }
  };

  // Process the Excel file
  const processExcelFile = async (selectedFile) => {
    try {
      // Read the Excel file
      const arrayBuffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(sheet);
      
      // Dynamically detect comparison and p-value columns from the headers
      const headers = Object.keys(rawData[0] || {});
      const comparisonPattern = /^Log2FC\s*\((.+)\)$/i;
      const pValuePattern = /^P value\s*\((.+)\)$/i;
      
      // Find all comparison columns and their display names
      const comparisons = headers.filter(h => comparisonPattern.test(h));
      const shortNames = comparisons.map(h => {
        const match = h.match(comparisonPattern);
        return match ? match[1].trim() : h;
      });
      
      // Find all p-value columns
      const pValueColumns = headers.filter(h => pValuePattern.test(h));
      
      // Sort comparisons and p-values by their order in the file
      // (Optional: you can sort by display name if you prefer)
      // If you want to pair Log2FC and P value columns by their inner comparison, you can add extra logic here.
      
      // Process gene data
      const geneData = rawData.map(gene => {
        return {
          id: gene['Gene ID'],
          category: gene['All Gene Ontology Category'] || 'Uncategorized',
          values: comparisons.map(comp => gene[comp]),
          pValues: pValueColumns.map(comp => gene[comp])
        };
      });
      
      // Group genes by category
      const categories = [...new Set(geneData.map(gene => gene.category))];
      const groupedByCategory = {};
      categories.forEach(category => {
        groupedByCategory[category] = geneData.filter(gene => gene.category === category);
      });
      
      // Sort genes within each category from lowest to highest log2FC in Control vs KD
      const sortedGeneData = [];
      categories.forEach(category => {
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
      
      setData({
        genes: sortedGeneData,
        comparisons: shortNames,
        comparisonColumns: comparisons,
        pValueColumns: pValueColumns,
        categoryGroups: categoryGroups
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
  const cellWidth = 150; // Wide cells for readability
  const cellHeight = 30;
  const margin = { top: 100, right: 40, bottom: 50, left: 200 }; // Increased top margin for legend

  // Color scale for heatmap - using d3 color interpolation
  const colorScale = (value) => {
    if (value === undefined || value === null) return "#f9f9f9";
    if (value > 0) {
      // Red for upregulation (0 to 3)
      const intensity = Math.min(Math.abs(value) / 3, 1);
      return d3.interpolateReds(intensity);
    } else {
      // Blue for downregulation (0 to -3)
      const intensity = Math.min(Math.abs(value) / 3, 1);
      return d3.interpolateBlues(intensity);
    }
  };

  // Significance indicator size scale
  const getSizeForPValue = (pValue) => {
    if (pValue >= 0.05) return 0;
    if (pValue < 0.01) return 5;
    return 3; // for p-values between 0.01 and 0.05
  };

  // Function to format category labels with line breaks where requested
  const formatCategoryLabel = (category) => {
    if (category === "Triglyceride Metabolism") {
      return ["Triglyceride", "Metabolism"];
    } else if (category === "Carbohydrate Metabolism") {
      return ["Carbohydrate", "Metabolism"];
    } else if (category === "Phospholipid Metabolism") {
      return ["Phospholipid", "Metabolism"];
    } else if (category === "RNA Processing/Neurodegeneration") {
      return ["RNA Processing/", "Neurodegeneration"];
    } else {
      return [category];
    }
  };

  const renderHeatmap = () => {
    if (!data) return null;

    const width = margin.left + (cellWidth * data.comparisons.length) + margin.right;
    const height = margin.top + (cellHeight * data.genes.length) + margin.bottom + 40;

    return (
      <div style={{ width: '100%', overflowX: 'auto', paddingTop: '20px' }} ref={exportContainerRef}>
        <svg width={width} height={height} ref={svgRef}>
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {/* Column Headers (Comparisons) */}
            {data.comparisons.map((comparison, j) => (
              <g key={`col-${j}`} transform={`translate(${j * cellWidth}, 0)`}>
                <text
                  x={cellWidth / 2}
                  y={-20}
                  textAnchor="middle"
                  fontWeight="bold"
                  fontSize="11px"
                >
                  {comparison}
                </text>
              </g>
            ))}
            
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
            
            {/* Category groups */}
            {data.categoryGroups.map((group, groupIndex) => {
              const groupY = group.startIndex * cellHeight;
              
              // Color code the category groups
              let groupColor = "#f0f0f0"; // default light gray
              
              // Different colors for different biological processes
              if (group.category.includes("Cholesterol")) {
                groupColor = "#e6f7ff"; // light blue
              } else if (group.category.includes("Fatty Acid")) {
                groupColor = "#e6ffe6"; // light green
              } else if (group.category.includes("Triglyceride")) {
                groupColor = "#fff2e6"; // light orange
              } else if (group.category.includes("Immune")) {
                groupColor = "#ffe6e6"; // light red
              } else if (group.category.includes("Carbohydrate")) {
                groupColor = "#f9f9e6"; // light yellow
              }
              
              // Format category label with line breaks if needed
              const categoryLines = formatCategoryLabel(group.category);
              
              return (
                <g key={`group-${groupIndex}`}>
                  {/* Group background and label */}
                  <rect
                    x={-margin.left}
                    y={groupY}
                    width={margin.left - 5}
                    height={group.count * cellHeight}
                    fill={groupColor}
                    stroke="#ccc"
                  />
                  
                  {/* Render category with line breaks if needed */}
                  {categoryLines.map((line, lineIndex) => (
                    <text
                      key={`category-line-${lineIndex}`}
                      x={-margin.left + 5}
                      y={groupY + 15 + (lineIndex * 15)}
                      fontWeight="bold"
                      fontSize="12px"
                      fill="#333"
                    >
                      {line}
                    </text>
                  ))}
                  
                  <text
                    x={-margin.left + 5}
                    y={groupY + 15 + (categoryLines.length * 15)}
                    fontSize="10px"
                    fill="#666"
                  >
                    ({group.count} genes)
                  </text>
                  
                  {/* Group separator */}
                  {groupIndex > 0 && (
                    <line
                      x1={-margin.left}
                      y1={groupY - 2}
                      x2={data.comparisons.length * cellWidth}
                      y2={groupY - 2}
                      stroke="#000"
                      strokeWidth="1"
                      strokeDasharray="5,5"
                    />
                  )}
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
                  fontSize="11px"
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
                    <g key={`cell-${i}-${j}`} transform={`translate(${j * cellWidth}, 0)`}>
                      <rect
                        width={cellWidth - 1}
                        height={cellHeight - 1}
                        fill={colorScale(value)}
                        stroke="#fff"
                        strokeWidth="1"
                      />
                      <text
                        x={cellWidth / 2}
                        y={cellHeight / 2 + 4}
                        textAnchor="middle"
                        fontSize="10px"
                        fontWeight={isSignificant ? "bold" : "normal"}
                        fill={Math.abs(value) > 1.5 ? "white" : "black"}
                      >
                        {value !== undefined && value !== null ? value.toFixed(1) : "N/A"}
                      </text>
                      {(isSignificant || isMarginal) && (
                        <circle
                          cx={cellWidth - 15}
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
  };

  // Function to export processed data as XLSX
  const downloadProcessedData = () => {
    if (!data) return;

    // Prepare the header
    const headers = [
      "Gene ID",
      "Category",
      ...data.comparisons.map(name => `Log2FC (${name})`),
      ...data.comparisons.map(name => `P-value (${name})`)
    ];

    // Prepare the rows
    const rows = data.genes.map(gene => {
      const log2fc = gene.values.map(v => v !== undefined && v !== null ? v : "N/A");
      const pvals = gene.pValues.map(v => v !== undefined && v !== null ? v : "N/A");
      // Build an object with all fields
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

    // Convert to worksheet
    const worksheet = window.XLSX
      ? window.XLSX.utils.json_to_sheet(rows, { header: headers })
      : XLSX.utils.json_to_sheet(rows, { header: headers });
    const workbook = window.XLSX
      ? window.XLSX.utils.book_new()
      : XLSX.utils.book_new();
    (window.XLSX ? window.XLSX.utils : XLSX.utils).book_append_sheet(workbook, worksheet, "Processed Data");

    // Download
    (window.XLSX ? window.XLSX : XLSX).writeFile(workbook, "processed_gene_data.xlsx");
  };

  return (
    <div className="p-4 bg-white overflow-auto">
      <h2 className="text-xl font-bold mb-2 text-center">Clustered Heatmap of Gene Expression by Biological Process</h2>
      <p className="text-sm text-center mb-4">Visualization of log2 fold changes across four experimental conditions</p>
      
      {/* File upload section */}
      <div className="mb-6 p-4 border rounded bg-gray-50">
        <h3 className="font-bold mb-2">Upload Excel File</h3>
        <p className="text-sm mb-2">
          Upload your Excel file with gene expression data. The file should include:
        </p>
        <ul className="text-sm list-disc pl-6 mb-4">
          <li>Gene ID column</li>
          <li>Log2FC comparison columns</li>
          <li>P-value columns</li>
          <li>All Gene Ontology Category column</li>
        </ul>
        <input 
          type="file" 
          accept=".xlsx, .xls" 
          onChange={handleFileUpload}
          className="block w-full text-sm border border-gray-300 rounded p-2"
        />
        {file && <p className="mt-2 text-sm text-blue-600">Using file: {file.name}</p>}
      </div>
      
      {loading && <div className="p-8 text-center">Loading gene expression data...</div>}
      
      {error && <div className="bg-red-50 text-red-600 p-4 rounded-md">{error}</div>}
      
      {data && (
        <>
          {renderHeatmap()}
          
          {/* Export buttons */}
          <div className="mt-4 flex space-x-4 justify-center">
            <button 
              onClick={downloadAsSVG}
              className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded"
            >
              Download as SVG
            </button>
            <button 
              onClick={downloadAsPNG}
              className="bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded"
            >
              Download as PNG
            </button>
            <button
              onClick={downloadProcessedData}
              className="bg-yellow-600 hover:bg-yellow-700 text-white py-2 px-4 rounded"
            >
              Download Processed Data (XLSX)
            </button>
          </div>
          
          <div className="mt-4 text-sm text-gray-600">
            <p className="font-bold">Visualization Legend:</p>
            <ul className="list-disc pl-8 mt-1">
              <li>Genes are grouped by biological process and sorted from lowest to highest log₂FC in the Control vs KD comparison</li>
              <li>Red indicates upregulation (positive log₂FC), blue indicates downregulation (negative log₂FC)</li>
              <li>Color intensity corresponds to the magnitude of change</li>
              <li>Black circles indicate statistical significance (p &lt; 0.05), with size proportional to significance level</li>
              <li>Larger circles (p &lt; 0.01) indicate higher statistical significance</li>
            </ul>
            <p className="mt-2">• The heatmap reveals patterns of gene expression changes across different biological processes and experimental conditions</p>
            <p>• This visualization helps identify coordinated regulation within functional pathways</p>
          </div>
        </>
      )}
    </div>
  );
};

export default ClusteredHeatmap;
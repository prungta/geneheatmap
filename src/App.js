import React from 'react';
import './App.css';
import ClusteredHeatmap from './ClusteredHeatmap';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Gene Expression Heatmap Visualization</h1>
      </header>
      <main className="container mx-auto py-6 px-4">
        <ClusteredHeatmap />
      </main>
      <footer className="py-4 text-center text-gray-600 text-sm">
        Gene Expression Visualization Tool
      </footer>
    </div>
  );
}

export default App;
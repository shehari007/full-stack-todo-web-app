import React from 'react';
import { PDFDownloadLink, Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';
import { Button } from 'antd';

function PDFDownloader({ TableData }) {
  const styles = StyleSheet.create({
    page: {
      flexDirection: 'row',
      backgroundColor: '#E4E4E4',
    },
    section: {
      margin: 10,
      padding: 10,
      flexGrow: 1,
    },
    table: {
      display: 'table',
      width: 'auto',
      borderStyle: 'solid',
      borderWidth: 1,
      borderRightWidth: 0,
      borderBottomWidth: 0,
    },
    tableRow: { flexDirection: 'row' },
    tableCol: {
      width: '33.33%',
      borderStyle: 'solid',
      borderWidth: 1,
      borderLeftWidth: 0,
      borderTopWidth: 0,
    },
    columnHeader: {
      fontWeight: 'bold',
    },
  });

  const Table = ({ data }) => (
    <View style={styles.table}>

      <View style={[styles.tableRow, styles.columnHeader]}>
        <View style={styles.tableCol}>
          <Text>Mission</Text>
        </View>
        <View style={styles.tableCol}>
          <Text>Date</Text>
        </View>
        <View style={styles.tableCol}>
          <Text>Checked</Text>
        </View>
      </View>

      {data && data.map((row, index) => (
        <View key={index} style={styles.tableRow}>
          <View style={styles.tableCol}>
            <Text>{row.text}</Text>
          </View>
          <View style={styles.tableCol}>
            <Text>{row.time}</Text>
          </View>
          <View style={styles.tableCol}>
            <Text>{row.checked ? 'true' : 'false'}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const MyDoc = () => (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Table data={TableData} />
        </View>
      </Page>
    </Document>
  );

  return (
    <div className="App">
      <PDFDownloadLink document={<MyDoc />} fileName="document.pdf">
        {({ loading }) => (
          <Button type="primary">
            Download PDF
          </Button>
        )}
      </PDFDownloadLink>
    </div>
  );
}

export default PDFDownloader;

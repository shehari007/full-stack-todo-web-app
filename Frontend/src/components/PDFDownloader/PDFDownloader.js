import React from 'react';
import { PDFDownloadLink, Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';
import { Button, Tooltip } from 'antd';
import { FilePdfOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { formatDate } from '../../utils/dateUtils';

function PDFDownloader({ TableData, trigger }) {
  const styles = StyleSheet.create({
    page: {
      padding: 40,
      backgroundColor: '#ffffff',
    },
    header: {
      marginBottom: 30,
      borderBottom: 2,
      borderBottomColor: '#4f46e5',
      paddingBottom: 15,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: '#1e293b',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 10,
      color: '#64748b',
    },
    table: {
      width: '100%',
    },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: '#f1f5f9',
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
    },
    tableRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: '#e2e8f0',
    },
    tableRowAlt: {
      backgroundColor: '#f8fafc',
    },
    tableCol1: {
      width: '50%',
      padding: 10,
    },
    tableCol2: {
      width: '25%',
      padding: 10,
    },
    tableCol3: {
      width: '25%',
      padding: 10,
    },
    headerText: {
      fontSize: 10,
      fontWeight: 'bold',
      color: '#1e293b',
    },
    cellText: {
      fontSize: 9,
      color: '#334155',
    },
    statusCompleted: {
      color: '#10b981',
      fontWeight: 'bold',
    },
    statusPending: {
      color: '#f59e0b',
      fontWeight: 'bold',
    },
    footer: {
      position: 'absolute',
      bottom: 30,
      left: 40,
      right: 40,
      textAlign: 'center',
      borderTop: 1,
      borderTopColor: '#e2e8f0',
      paddingTop: 10,
    },
    footerText: {
      fontSize: 8,
      color: '#94a3b8',
    },
    stats: {
      flexDirection: 'row',
      marginTop: 20,
      gap: 20,
    },
    statBox: {
      padding: 12,
      backgroundColor: '#f1f5f9',
      borderRadius: 4,
      flex: 1,
    },
    statLabel: {
      fontSize: 8,
      color: '#64748b',
      marginBottom: 4,
    },
    statValue: {
      fontSize: 16,
      fontWeight: 'bold',
      color: '#1e293b',
    },
  });

  const TaskDocument = () => {
    const data = TableData || [];
    const completed = data.filter(t => t.checked).length;
    const pending = data.length - completed;

    return (
      <Document>
        <Page size="A4" style={styles.page}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>TaskFlow - Task Report</Text>
            <Text style={styles.subtitle}>
              Generated on {dayjs().format('MMMM DD, YYYY [at] HH:mm')}
            </Text>
          </View>

          {/* Stats */}
          <View style={styles.stats}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Total Tasks</Text>
              <Text style={styles.statValue}>{data.length}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Completed</Text>
              <Text style={[styles.statValue, { color: '#10b981' }]}>{completed}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Pending</Text>
              <Text style={[styles.statValue, { color: '#f59e0b' }]}>{pending}</Text>
            </View>
          </View>

          {/* Table */}
          <View style={[styles.table, { marginTop: 20 }]}>
            {/* Header Row */}
            <View style={[styles.tableRow, styles.tableHeader]}>
              <View style={styles.tableCol1}>
                <Text style={styles.headerText}>Task</Text>
              </View>
              <View style={styles.tableCol2}>
                <Text style={styles.headerText}>Due Date</Text>
              </View>
              <View style={styles.tableCol3}>
                <Text style={styles.headerText}>Status</Text>
              </View>
            </View>

            {/* Data Rows */}
            {data.map((row, index) => (
              <View 
                key={index} 
                style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}
              >
                <View style={styles.tableCol1}>
                  <Text style={styles.cellText}>{row.text}</Text>
                </View>
                <View style={styles.tableCol2}>
                  <Text style={styles.cellText}>{formatDate(row.time, 'medium')}</Text>
                </View>
                <View style={styles.tableCol3}>
                  <Text style={[
                    styles.cellText, 
                    row.checked ? styles.statusCompleted : styles.statusPending
                  ]}>
                    {row.checked ? '✓ Completed' : '○ Pending'}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              TaskFlow - Stay organized, stay productive
            </Text>
          </View>
        </Page>
      </Document>
    );
  };

  const fileName = `TaskFlow_Report_${dayjs().format('YYYY-MM-DD')}.pdf`;

  return (
    <PDFDownloadLink document={<TaskDocument />} fileName={fileName}>
      {({ loading }) => (
        trigger ? (
          React.cloneElement(trigger, { 
            loading,
            disabled: loading || !TableData?.length
          })
        ) : (
          <Tooltip title={!TableData?.length ? 'No tasks to export' : 'Download PDF'}>
            <Button 
              icon={loading ? <DownloadOutlined spin /> : <FilePdfOutlined />}
              loading={loading}
              disabled={!TableData?.length}
            >
              Export PDF
            </Button>
          </Tooltip>
        )
      )}
    </PDFDownloadLink>
  );
}

export default PDFDownloader;

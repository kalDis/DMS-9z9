const ExcelJS = require('exceljs');
const path = require('path');

async function create() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Orders');

  sheet.columns = [
    { header: 'Tracking Number', key: 'tracking_number', width: 15 },
    { header: 'Customer Name', key: 'customer_name', width: 20 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Address', key: 'address', width: 30 },
    { header: 'Product', key: 'product', width: 20 },
    { header: 'Salesperson', key: 'salesperson', width: 15 },
    { header: 'Branch', key: 'branch', width: 12 },
  ];

  const orders = [
    { tracking_number: 'DX002001', customer_name: 'Nuwan Perera', phone: '0771001001', address: '10 Main St, Colombo', product: 'Headphones', salesperson: 'Nimal S.', branch: 'Colombo' },
    { tracking_number: 'DX002002', customer_name: 'Sanduni Fernando', phone: '0712002002', address: '25 Lake Rd, Kandy', product: 'Tablet Stand', salesperson: 'Priya K.', branch: 'Kandy' },
    { tracking_number: 'DX002003', customer_name: 'Ravindu Silva', phone: '0753003003', address: '8 Beach Ave, Galle', product: 'Mouse Pad', salesperson: 'Amara R.', branch: 'Galle' },
    { tracking_number: 'DX002004', customer_name: 'Hiruni Jayawardena', phone: '0784004004', address: '42 Park Ln, Colombo', product: 'USB Cable', salesperson: 'Kasun M.', branch: 'Colombo' },
    { tracking_number: 'DX002005', customer_name: 'Tharaka Bandara', phone: '0705005005', address: '15 Hill St, Negombo', product: 'Phone Case', salesperson: 'Nimal S.', branch: 'Negombo' },
    // Duplicate - already exists in seed data
    { tracking_number: 'DX001234', customer_name: 'Kamal Perera Updated', phone: '0771234567', address: '123 Galle Rd, Colombo', product: 'Wireless Earbuds v2', salesperson: 'Nimal S.', branch: 'Colombo' },
    { tracking_number: 'DX001235', customer_name: 'Sitha Fernando Updated', phone: '0712345678', address: '45 Kandy Rd', product: 'Smart Watch v2', salesperson: 'Priya K.', branch: 'Kandy' },
  ];

  orders.forEach(o => sheet.addRow(o));

  const outPath = path.join(__dirname, '..', '..', 'sample-orders.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log(`Sample Excel created: ${outPath}`);
}

create();

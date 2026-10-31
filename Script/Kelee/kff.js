let obj = JSON.parse($response.body);
const blockedIds = [
  "13502ede-f5fd-4d5c-90f5-f2454a30fda0",
  "c1caaf62-e91d-4040-b533-dab39c0fec13",
  "cc9d17ec-3ac5-494b-b82e-8d3c72c243d4",
  "7bef8fe9-0daf-46b3-a2b0-dd9fba49423f",
  "ff7e1263-d8d2-4f09-9947-d8c43c77bb10",
  "874197b4-fe93-4a80-a555-8df1bc7e8211",
  "0ba6a615-b7e9-48aa-afe7-329635385f2c",
  "a11b0e7d-a162-4802-ac71-21d98e8adddf"
];
obj.data.config = JSON.stringify(
  JSON.parse(obj.data.config).filter(item => !blockedIds.some(id => item.id.includes(id)))
);
$done({body: JSON.stringify(obj)});

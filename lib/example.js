/* Two real shifts from Nov 23, 2026. Used by the tests and shown as example
   data until a Samsara API key is added. */
const T = (d, n, s, e, f, t, m) => ({ step_type: 'TRIP_ENTRY', driverId: d, driverName: n, step_startMs: s, step_endMs: e, step_startName: f, step_endName: t, step_distanceMeters: m });

module.exports = {
  trips: {
    A287: [
      T(25643258, 'DANIEL SANDOVAL', 1795390083023, 1795393596096, 'Continental Station - PBF', 'Petrol Transport', 68365),
      T(25643258, 'DANIEL SANDOVAL', 1795440206013, 1795442622007, 'Petrol Transport', 'WF36', 42796),
      T(25643258, 'DANIEL SANDOVAL', 1795446464011, 1795450650008, 'WF36', 'Continental Station - PBF', 70460),
      T(25643258, 'DANIEL SANDOVAL', 1795453443019, 1795461043041, 'Continental Station - PBF', 'Magenheimer Lease', 172693),
      T(25643258, 'DANIEL SANDOVAL', 1795465580047, 1795473651005, 'Magenheimer Lease', 'Pentland Station', 168781),
      T(25643258, 'DANIEL SANDOVAL', 1795475865028, 1795476155007, 'Pentland Station', 'Pentland Station', 915),
      T(25643258, 'DANIEL SANDOVAL', 1795476662014, 1795480156511, 'Pentland Station', 'Petrol Transport', 77478)
    ],
    J1: [
      T(30822095, 'JUAN RAMOS', 1795440326025, 1795441476024, 'Petrol Transport', 'Mt Poso Lease', 20226),
      T(30822095, 'JUAN RAMOS', 1795443345511, 1795455645499, null, 'Olympus Berth 209', 246672),
      T(30822095, 'JUAN RAMOS', 1795461598510, 1795467546511, 'Olympus Berth 209', null, 77913),
      T(30822095, 'JUAN RAMOS', 1795467899512, 1795471493505, null, null, 58418),
      T(30822095, 'JUAN RAMOS', 1795473686520, 1795478326022, null, 'Robinson B Dehy Lease', 101096),
      T(30822095, 'JUAN RAMOS', 1795483606013, 1795485020507, 'Robinson B Dehy Lease', 'Dixie Lee Lease', 18031),
      T(30822095, 'JUAN RAMOS', 1795491701063, 1795492688083, 'Dixie Lee Lease', 'Petrol Transport', 13822)
    ]
  },
  hos: {
    '25643258': [[1795394238000, 1795439482000, 1], [1795439482000, 1795440179000, 4], [1795440179000, 1795442617000, 3], [1795442617000, 1795446387000, 4], [1795446387000, 1795450801000, 3], [1795450801000, 1795453419000, 1], [1795453419000, 1795461055000, 3], [1795461055000, 1795465565000, 4], [1795465565000, 1795473656000, 3], [1795473656000, 1795475854000, 1], [1795475854000, 1795476505052, 3], [1795476505052, 1795476678026, 4], [1795476678026, 1795480272000, 3], [1795480272000, 1795481244000, 4], [1795481244000, 1795507200000, 1]]
      .map(x => ({ startMs: x[0], endMs: x[1], activityStatus: x[2] }))
  }
};

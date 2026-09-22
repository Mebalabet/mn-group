// Owner-maintained public business facts for MN Group AI support.
//
// IMPORTANT:
// - Only put facts here that MN Group has actually confirmed.
// - Status values prevent the AI from turning unknown information into claims.
// - Never put secrets, credentials, private customer data, order records,
//   payment records, JWTs, seller IDs, file names, or internal notes here.

module.exports = {
  identity: {
    title: 'MN Group',
    description: {
      status: 'confirmed',
      value: 'A digital marketplace for products and technology-related services.'
    },
    legalEntity: {
      status: 'not_available',
      value: null
    },
    location: {
      status: 'not_available',
      value: null
    }
  },

  categories: {
    status: 'confirmed',
    values: [
      'software',
      'templates',
      'design',
      'plugins',
      'courses',
      'services',
      'other'
    ]
  },

  products: {
    digitalProducts: {
      status: 'confirmed',
      value: true
    },
    physicalProducts: {
      status: 'not_available',
      value: null
    },
    shipping: {
      status: 'not_available',
      value: null
    }
  },

  services: {
    quoteBased: {
      status: 'confirmed',
      value: true
    },
    serviceLines: {
      status: 'not_confirmed',
      value: []
    },
    customWork: {
      status: 'confirmed',
      value: 'Custom requirements can be submitted through the quote request process.'
    }
  },

  courses: {
    categoryExists: {
      status: 'confirmed',
      value: true
    },
    lms: {
      status: 'not_available',
      value: null
    },
    certificates: {
      status: 'not_available',
      value: null
    },
    progressTracking: {
      status: 'not_available',
      value: null
    }
  },

  buying: {
    account: {
      status: 'confirmed',
      value: 'Customers can create an account and sign in.'
    },
    cart: {
      status: 'confirmed',
      value: 'Products can be added to the cart before checkout.'
    },
    checkout: {
      status: 'confirmed',
      value: 'Checkout creates an order that remains pending until payment is confirmed.'
    }
  },

  digitalDelivery: {
    nativeDownloads: {
      status: 'confirmed',
      value: 'Some products may use MN Group native digital delivery when a valid downloadable file is configured.'
    },
    externalDelivery: {
      status: 'confirmed',
      value: 'Some products may use an external Payhip purchase/delivery link when configured by the seller.'
    },
    exactDelivery: {
      status: 'not_confirmed',
      value: null
    }
  },

  sellers: {
    registration: {
      status: 'confirmed',
      value: 'A normal registration creates a buyer account; seller/admin privileges are not granted simply by being the first registered user.'
    },
    productSubmission: {
      status: 'confirmed',
      value: 'Logged-in users can submit products. Non-admin submissions require administrative approval before appearing in the approved catalog.'
    },
    approval: {
      status: 'confirmed',
      value: 'Product approval is controlled by MN Group administration.'
    }
  },

  quotes: {
    status: 'confirmed',
    process: [
      'Submit a quote request describing the requirement.',
      'MN Group reviews the request.',
      'A quote may be provided.',
      'The request can then proceed through the applicable quote workflow.'
    ]
  },

  payments: {
    paymentProcessing: {
      status: 'pending_owner_input',
      value: null
    },
    payU: {
      status: 'pending_owner_input',
      value: null
    },
    refunds: {
      status: 'not_available',
      value: null
    },
    disputes: {
      status: 'not_available',
      value: null
    }
  },

  contact: {
    publicContact: {
      status: 'not_available',
      value: null
    },
    whatsapp: {
      status: 'not_available',
      value: null
    }
  },

  privacy: {
    customerRecords: {
      status: 'not_available',
      value: null
    },
    orderRecords: {
      status: 'not_available',
      value: null
    },
    paymentRecords: {
      status: 'not_available',
      value: null
    }
  }
};

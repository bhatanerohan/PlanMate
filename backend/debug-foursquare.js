const options = {
  method: 'GET',
  headers: {
    accept: 'application/json',
    'X-Places-Api-Version': '2025-06-17',
    authorization: 'Bearer 0X1SMMTNUCAABWHMXQJPWMTTCIRUKHKJMNZYZK2Y5MWHPKHL'
  }
};

fetch('https://places-api.foursquare.com/places/search', options)
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(err => console.error(err));
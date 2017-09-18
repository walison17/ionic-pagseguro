import { Injectable } from '@angular/core';
import { PagSeguroDefaultOptions } from './pagseguro.defaults';
import { RequestOptions, Http, Headers } from '@angular/http';
import { PagSeguroOptions } from './pagseguro.options';
//import { Observable } from "rxjs/Observable";
     
import { PagSeguroData } from './pagseguro.data';
import { FormGroup } from '@angular/forms';

//import 'rxjs/add/operator/map';
import 'rxjs/add/operator/toPromise';

declare var PagSeguroDirectPayment: any;

@Injectable() 
export class PagSeguroService {
 
  private ZIP_URL = 'https://viacep.com.br/ws';

  private scriptLoaded: boolean;
  private options: PagSeguroOptions;
  public creditCardHash;
  private checkoutData: PagSeguroData;
  private paymentForm: FormGroup;

  constructor(private http: Http) {
    this.options = PagSeguroDefaultOptions;
  }

  public setOptions(options: PagSeguroOptions) {
    // this.options = Object.assign(PagSeguroDefaultOptions, options);
    Object.assign(this.options, options);
  }

  public getOptions(): PagSeguroOptions {
    return this.options;
  } 

  public setForm(paymentForm: FormGroup) {
    this.paymentForm = paymentForm;
  }

  /**
   * Carrega o <script> do PagSeguro no HEAD do documento
   */
  public loadScript(): Promise<any> {
    //console.debug('Will load options with URL', this.options.scriptURL);
    var promise = new Promise((resolve) => {
      if (this.options.loadScript && !this.scriptLoaded) {
        let script: HTMLScriptElement = document.createElement('script');
        script.addEventListener('load', r => resolve());
        script.src = this.options.scriptURL;
        document.head.appendChild(script);

        this.scriptLoaded = true;
      } else {
        console.debug('Script is already loaded. Skipping...');
        resolve();
      }
    });
    return promise;
  }


  /**
   * Inicia a sessao com o PagSeguro, invocando uma Firebase Function
   */
  //public startSession(): Observable<any> {
  public startSession(): Promise<any> {

    let headers = new Headers({ 'Content-Type': 'application/json' });
    let requestOptions = new RequestOptions({ headers: headers });

    //return this.http.get(this.options.remoteApi.sessionURL, requestOptions).map((res: Response) => res.json());
    return this.http.get(this.options.remoteApi.sessionURL, requestOptions).toPromise();
  }

  /**
   * Rexupera as opções de pagamento. 
   * Esta funcção deve ser chamada após já termos iniciado a sessão, pelo startSession()
   */
  public getPaymentMethods(amount: number): Promise<any> {
    var promise = new Promise((resolve, reject) => {
      // recupera as opçoes de pagamento através da API Javscript do PagSeguro
      PagSeguroDirectPayment.getPaymentMethods({
        amount: amount,
        success: function (response) {
          resolve(response);
        },
        error: function (response) {
          reject(response);
        }
      });
    });
    return promise;
  }

  /**
   * Recupera a bandeira do cartão através dos 6 primeiros numeros do cartão (PIN)
   */
  public getCardBrand(pin: string): Promise<any> {
    var promise = new Promise((resolve, reject) => {
      PagSeguroDirectPayment.getBrand({
        cardBin: pin,
        success: function (response) {
          resolve(response);
        },
        error: function (response) {
          reject(response);
        }
      });
    });
    return promise;
  } 

  
  /**
   * Use esta função para definir os itens e valores que devem entrar no checkout do PagSeguro
   * @param data 
   */
  public addCheckoutData(data: PagSeguroData, skipPatchForm?: boolean) { 
    this.checkoutData = Object.assign(this.checkoutData || {}, data);
    //this.checkoutData = Object.assign(data, this.checkoutData || {});

    console.debug('checkout data added', this.checkoutData);

    if (!skipPatchForm) {

      // adiciona alguns campos no próprio formulario de checkout
      if (this.checkoutData.sender && this.checkoutData.sender.name) {
        this.paymentForm.patchValue({
          card: {
            name: this.checkoutData.sender.name
          }
        });

        if (this.checkoutData.sender.documents && this.checkoutData.sender.documents.document.type === 'CPF') {
          this.paymentForm.patchValue({
            card: {
              cpf: this.checkoutData.sender.documents.document.value
            }
          });
        }

        if (this.checkoutData.sender.phone) {
          this.paymentForm.patchValue({
            phone: this.checkoutData.sender.phone.areaCode + this.checkoutData.sender.phone.number
          })
        }
      }

      if (this.checkoutData.creditCard && this.checkoutData.creditCard.billingAddress) {
        this.patchAddress(this.checkoutData.creditCard.billingAddress);
      }
    }
  } 

  public patchAddress(address) {
    this.paymentForm.patchValue({
      address: address
    });
  }

  /**  
   * Monta o objeto necessário para a API do PagSeguro
   */
  buildPagSeguroData(): PagSeguroData {
    let data: PagSeguroData = {
      method: 'creditCard',
      shipping: {
        addressRequired: false
      },
      creditCard: {
        cardNumber: this.paymentForm.value.card.cardNumber,
        cvv: this.paymentForm.value.card.cvv,
        expirationMonth: this.paymentForm.value.card.validity.substring(5),
        expirationYear: this.paymentForm.value.card.validity.substring(0, 4),
        billingAddress: this.paymentForm.value.address,
        holder: {
          name: this.paymentForm.value.card.name,
          documents: {
            document: {
              type: 'CPF',
              value: this.paymentForm.value.card.cpf
            }
          }
        }
      },
      sender: {
        phone: {
          areaCode: this.paymentForm.value.phone.substring(0, 2),
          number: this.paymentForm.value.phone.substring(2)
        }
      }
    }
    return data;
  }

  

  /**
   * Função que realiza o pagamento com o PagSeguro.
   * Ela irá passar os dados resgatados, para uma Firebase Functio, que irá concluir o processo
   * 
   * @param data 
   */
  public checkout(): Promise<any> {
    let data:PagSeguroData = this.buildPagSeguroData();
    console.debug('Tentando checkout com os dados', data);
    data.sender.name = this.checkoutData.sender.name;
    data.sender.email = this.checkoutData.sender.email;
    data.sender.documents = this.checkoutData.sender.documents;

    data = Object.assign(this.checkoutData, data);
    //data = Object.assign(data, this.checkoutData);
    data.sender.hash = PagSeguroDirectPayment.getSenderHash();

    console.debug('merge do checkoutData', data)
    // recupera o token do cartao de crédito
    //var promise = new Promise((resolve, reject) => {
      if (data.method == 'creditCard') {
        return this.createCardToken(data).then(result => {
          data.creditCard.token = result.card.token;

          // removendo dados nao necessarios do cartao
          delete (data.creditCard.cardNumber);
          delete (data.creditCard.cvv);
          delete (data.creditCard.expirationMonth);
          delete (data.creditCard.expirationYear);

          return this._checkout(data);
        });
        /*
        .catch(error => {
          console.debug('error ao criar token do cartao', error);
          reject(error);
        });
        */
      } else {
        return this._checkout(data);
      }
    //});
    //return promise;
  }

  /**
   * Invoca a API do Firebase Function com todos os dados necessários
   * Essa API deverá chamar a função de /transactions do PagSeguro para concluir a transação
   * @param data
   */
  private _checkout(data: PagSeguroData): Promise<any> {
   /*
    var promise = new Promise((resolve, reject) => {
      console.debug('invocando a API com os dados', data);
      resolve('ok');
    });
    return promise;
    */

    console.debug('invocando a API com os dados.', data);

    var headers = new Headers();
    headers.append('Content-Type', 'application/json');
    if (data.token) headers.append('Authorization', 'Bearer ' + data.token);

    let requestOptions = new RequestOptions({ headers: headers });

    //return this.http.get(this.options.remoteApi.checkoutURL, requestOptions).map((res: Response) => res.json());
    return this.http.post(this.options.remoteApi.checkoutURL, JSON.stringify(data), requestOptions).toPromise();

  }

  /**
   * Cria um Token para o cartão de crédito informado
   * @param data 
   */
  public createCardToken(data: PagSeguroData): Promise<any> {
    var promise = new Promise((resolve, reject) => {
      PagSeguroDirectPayment.createCardToken({
        cardNumber: data.creditCard.cardNumber,
        cvv: data.creditCard.cvv,
        expirationMonth: data.creditCard.expirationMonth,
        expirationYear: data.creditCard.expirationYear,
        success: function (response) {
          resolve(response);
        },
        error: function (response) {
          reject(response);
        }
      });
    });
    return promise;
  } 

  /**
   * Fetches zip code information. (works for Brazil)
   * @param zip 
   */
  public fetchZip(zip: string): Promise<any> {
    //return this.httpClient.get<any>(`${this.ZIP_URL}/${zip}/json`).retry(2);
    return this.http.get(`${this.ZIP_URL}/${zip}/json`).toPromise();
  }

  /**
   * Faz um match dos dados retornados pelo Viacep, com o formato necessário para o PagSeguro
   * @param address 
   */
  public matchAddress(address: any): PagSeguroData {
    if (address) {
      let addressData: PagSeguroData = {
        creditCard: {
          billingAddress: {
            state: address.uf,
            country: 'BRA',
            postalCode: address.cep.replace('-', ''),
            number: '',
            city: address.localidade,
            street: address.logradouro,
            district: address.bairro
          }
        }
      }
      return addressData;
    }
    return null;
    
  }

  /*

  public store(dados: Dados) {

    let headers = new Headers({ 'Content-Type': 'application/json' });
    let options = new RequestOptions({ headers: headers });

    let body = JSON.stringify({ dados });
    return this.http.post('http://www.suaApi.com.br/store', body, options)
      .map(res => res.json());
  }

  public cancel() {

    let headers = new Headers({ 'Content-Type': 'application/json' });
    let options = new RequestOptions({ headers: headers });

    return this.http.get('http://www.suaApi.com.br/cancel', options)
      .map(res => res.json());
  }
  */


}
